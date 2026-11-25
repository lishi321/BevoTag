// Survey/CSI firmware for the ESP32-C5 (dual-band 2.4 + 5 GHz). Needs Arduino core 3.3+ (pioarduino).
#include <WiFi.h>
#include <esp_wifi.h>
#include <freertos/queue.h>

#if !CONFIG_SOC_WIFI_SUPPORT_5G || CONFIG_SOC_WIFI_MAC_VERSION_NUM != 3
#error "This firmware targets the ESP32-C5 (5 GHz WiFi, MAC v3 CSI API). Build the esp32-c5 env."
#endif

// ---------------------------------------------------------------- session settings
// One {"cmd":"scan"} runs a full capture session:
//   Phase 1 (RSSI): repeated active scans over every 2.4 and 5 GHz channel, each sent as a PROTOCOL.md "scan" message
//   Phase 2 (CSI):  promiscuous CSI capture, hopping through every usable 2.4 and 5 GHz channel
static const uint32_t RSSI_PHASE_MS = 3UL * 60 * 1000;   // 3 min
static const uint32_t CSI_PHASE_MS  = 5UL * 60 * 1000;   // 5 min, split evenly across the usable CSI channels

// Regulatory domain. Decides which channels scans probe and CSI can tune to (5 GHz especially).
// 802.11d is off so nearby APs can't change it mid-survey.
static const char *WIFI_COUNTRY = "US";

// Every 20 MHz primary channel worth trying. At boot each one is tried with esp_wifi_set_channel and only the
// ones the radio accepts under WIFI_COUNTRY are kept (so e.g. 12/13 drop out under "US").
static const uint8_t CSI_CANDIDATES[] = {
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,                         // 2.4 GHz
  36, 40, 44, 48,                                                    // 5 GHz UNII-1
  52, 56, 60, 64,                                                    // UNII-2A (DFS)
  100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144,        // UNII-2C (DFS)
  149, 153, 157, 161, 165, 169, 173, 177                             // UNII-3/4
};
static const uint8_t CSI_MAX_CH = sizeof CSI_CANDIDATES;
static uint8_t csiChannels[CSI_MAX_CH];
static uint8_t csiNumCh = 0;
static uint32_t csiDwellMs = 0;
static bool bandModeOk = false;

uint32_t seq = 0;

// ---------------------------------------------------------------- CSI capture
// The WiFi driver calls csi_cb from its own task, so it must be fast: it only copies the packet into a
// queue. The main loop prints queued packets. Packets that arrive while the queue is full are counted as dropped.
static const uint16_t CSI_MAX_LEN = 612;   // C5 HE20/HT40 LTFs + L-LTF fit; longer buffers are truncated (len_raw says so)
struct CsiPkt {
  uint32_t ms;          // millis() at receive
  uint32_t ts_us;       // radio timestamp (us)
  uint8_t  mac[6];
  int8_t   rssi;
  int8_t   noise;
  uint8_t  ch;          // primary channel (1-14 = 2.4 GHz, 36+ = 5 GHz)
  uint8_t  ch2;         // secondary channel field from rx_ctrl (HT40 only)
  uint8_t  bb_fmt;      // rx_ctrl.cur_bb_format: PPDU format (11b / 11g / HT / VHT / HE SU / HE MU ...)
  uint8_t  first_invalid;
  uint16_t len_raw;     // length the driver gave
  uint16_t len;         // bytes kept
  int8_t   data[CSI_MAX_LEN];
};
static QueueHandle_t csiQueue = nullptr;
static volatile uint32_t csiDropped = 0;

void csi_cb(void *ctx, wifi_csi_info_t *info) {
  if (!info || !info->buf || info->len == 0 || !csiQueue) return;
  static CsiPkt p;  // only the WiFi task calls this, so one static buffer is safe
  p.ms = millis();
  p.ts_us = info->rx_ctrl.timestamp;
  memcpy(p.mac, info->mac, 6);
  p.rssi = info->rx_ctrl.rssi;
  p.noise = info->rx_ctrl.noise_floor;
  p.ch = info->rx_ctrl.channel;
  p.ch2 = info->rx_ctrl.second;
  p.bb_fmt = info->rx_ctrl.cur_bb_format;
  p.first_invalid = info->first_word_invalid;
  p.len_raw = info->len;
  p.len = info->len > CSI_MAX_LEN ? CSI_MAX_LEN : info->len;
  memcpy(p.data, info->buf, p.len);
  if (xQueueSend(csiQueue, &p, 0) != pdTRUE) csiDropped++;
}

// Print every queued CSI packet as one JSON line. Returns how many were printed.
static uint32_t drainCsi() {
  static CsiPkt p;
  static char line[128 + CSI_MAX_LEN * 5];
  uint32_t n = 0;
  while (xQueueReceive(csiQueue, &p, 0) == pdTRUE) {
    int o = snprintf(line, sizeof line,
      "{\"type\":\"csi\",\"ms\":%lu,\"ts_us\":%lu,\"mac\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"rssi\":%d,\"noise\":%d,"
      "\"ch\":%u,\"ch2\":%u,\"bb_fmt\":%u,\"first_invalid\":%u,\"len_raw\":%u,\"len\":%u,\"data\":[",
      (unsigned long)p.ms, (unsigned long)p.ts_us, p.mac[0], p.mac[1], p.mac[2], p.mac[3], p.mac[4], p.mac[5],
      p.rssi, p.noise, p.ch, p.ch2, p.bb_fmt, p.first_invalid, p.len_raw, p.len);
    for (uint16_t i = 0; i < p.len; i++) o += snprintf(line + o, sizeof line - o, i ? ",%d" : "%d", p.data[i]);
    o += snprintf(line + o, sizeof line - o, "]}\n");
    Serial.write((const uint8_t *)line, o);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- radio setup
// Find which candidate channels the radio accepts under the current country. Call with WiFi started, not scanning.
static void probeChannels() {
  csiNumCh = 0;
  for (uint8_t i = 0; i < CSI_MAX_CH; i++)
    if (esp_wifi_set_channel(CSI_CANDIDATES[i], WIFI_SECOND_CHAN_NONE) == ESP_OK) csiChannels[csiNumCh++] = CSI_CANDIDATES[i];
  csiDwellMs = csiNumCh ? CSI_PHASE_MS / csiNumCh : 0;
}

static void printChannelList(const uint8_t *chs, uint8_t n) {
  Serial.print('[');
  for (uint8_t i = 0; i < n; i++) Serial.printf(i ? ",%u" : "%u", chs[i]);
  Serial.print(']');
}

// ---------------------------------------------------------------- messages
void sendHello() {
  wifi_band_mode_t bm = WIFI_BAND_MODE_2G_ONLY;
  esp_wifi_get_band_mode(&bm);
  char cc[4] = {0};                         // driver writes 3 chars, e.g. "US " (no terminator)
  esp_wifi_get_country_code(cc);
  if (cc[2] == ' ') cc[2] = 0;
  uint8_t n24 = 0;
  for (uint8_t i = 0; i < csiNumCh; i++) n24 += csiChannels[i] <= 14;
  Serial.printf("{\"type\":\"hello\",\"v\":1,\"fw\":\"0.3.0\",\"chip\":\"%s\",\"mac\":\"%s\",\"country\":\"%s\","
                "\"band_mode\":\"%s\",\"rssi_phase_ms\":%lu,\"csi_phase_ms\":%lu,\"csi_dwell_ms\":%lu,"
                "\"csi_ch_24\":",
                ESP.getChipModel(), WiFi.macAddress().c_str(), cc,
                bm == WIFI_BAND_MODE_AUTO ? "2.4+5" : bm == WIFI_BAND_MODE_5G_ONLY ? "5" : "2.4",
                (unsigned long)RSSI_PHASE_MS, (unsigned long)CSI_PHASE_MS, (unsigned long)csiDwellMs);
  printChannelList(csiChannels, n24);
  Serial.print(",\"csi_ch_5\":");
  printChannelList(csiChannels + n24, csiNumCh - n24);
  Serial.print("}\n");
  if (!bandModeOk) Serial.print("{\"type\":\"err\",\"msg\":\"could not enable dual-band mode; 5 GHz unavailable\"}\n");
}

static long parseId(const String &line) {
  int k = line.indexOf("\"id\":");
  return k >= 0 ? line.substring(k + 5).toInt() : -1;
}

// Handle commands that arrive while a session is running.
// RSSI phase: a new "scan" command only updates the id, so each reply matches what the app is waiting for.
// CSI phase: "scan" gets an err with the time left (the app shows it and stops after 3 in a row).
static void pollCommands(long &id, bool csiPhase, uint32_t msLeft) {
  while (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    if (line.indexOf("\"hello\"") >= 0) sendHello();
    else if (line.indexOf("\"scan\"") >= 0) {
      if (!csiPhase) id = parseId(line);
      else Serial.printf("{\"type\":\"err\",\"msg\":\"busy: CSI capture, %lus left\"}\n", (unsigned long)(msLeft / 1000));
    }
  }
}

// One active scan over all 2.4 and 5 GHz channels (band mode is AUTO, channel 0 = all), sent as a PROTOCOL.md v1
// "scan" message. 5 GHz APs show up with ch >= 36. DFS channels are scanned passively by the driver.
static void scanOnce(long id) {
  uint32_t t0 = millis();
  int n = WiFi.scanNetworks(false, true); // blocking active scan, include hidden, 100-300 ms per channel
  if (n < 0) { Serial.printf("{\"type\":\"err\",\"msg\":\"scan failed: %d\"}\n", n); return; }
  uint32_t t1 = millis();
  Serial.printf("{\"type\":\"scan\",\"v\":1,\"id\":%ld,\"seq\":%lu,\"ms\":%lu,\"dur_ms\":%lu,\"aps\":[",
                id, (unsigned long)++seq, (unsigned long)t1, (unsigned long)(t1 - t0));
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i); ssid.replace("\\", "\\\\"); ssid.replace("\"", "\\\"");
    Serial.printf("%s{\"bssid\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d,\"ch\":%d}",
                  i ? "," : "", WiFi.BSSIDstr(i).c_str(), ssid.c_str(), WiFi.RSSI(i), WiFi.channel(i));
  }
  Serial.print("]}\n");
  WiFi.scanDelete();
}

// ---------------------------------------------------------------- capture session
void doScan(long id) {
  uint32_t t0 = millis();
  Serial.printf("{\"type\":\"session\",\"event\":\"start\",\"id\":%ld,\"ms\":%lu,\"rssi_phase_ms\":%lu,\"csi_phase_ms\":%lu}\n",
                id, (unsigned long)t0, (unsigned long)RSSI_PHASE_MS, (unsigned long)CSI_PHASE_MS);

  // Phase 1: RSSI. Keep scanning until 3 min have passed (the scan in progress finishes, so it can run a few s over).
  uint32_t scans = 0;
  while (millis() - t0 < RSSI_PHASE_MS) {
    pollCommands(id, false, 0);
    scanOnce(id);
    scans++;
    delay(10);
  }
  uint32_t t1 = millis();
  Serial.printf("{\"type\":\"session\",\"event\":\"rssi_done\",\"id\":%ld,\"ms\":%lu,\"scans\":%lu,\"dur_ms\":%lu}\n",
                id, (unsigned long)t1, (unsigned long)scans, (unsigned long)(t1 - t0));

  // Phase 2: CSI. Promiscuous mode gives CSI for every packet heard on the channel, not just our own AP's.
  // C5 CSI config: take every LTF type it can (legacy, HT20/40, VHT, HE SU/MU), 8-bit I/Q so data stays int8 pairs.
  wifi_csi_config_t csi_config = {};
  csi_config.enable = 1;
  csi_config.acquire_csi_legacy = 1;
  csi_config.acquire_csi_force_lltf = 0;
  csi_config.acquire_csi_ht20 = 1;
  csi_config.acquire_csi_ht40 = 1;
  csi_config.acquire_csi_vht = 1;
  csi_config.acquire_csi_su = 1;
  csi_config.acquire_csi_mu = 1;
  csi_config.acquire_csi_dcm = 1;
  csi_config.acquire_csi_beamformed = 1;
  csi_config.acquire_csi_he_stbc_mode = ESP_CSI_ACQUIRE_STBC_SAMPLE_HELTFS;
  csi_config.val_scale_cfg = 0;
  csi_config.dump_ack_en = 0;
  csi_config.lltf_bit_mode = 1;   // 8-bit L-LTF I/Q (default 12-bit would not fit the int8 output)

  xQueueReset(csiQueue);
  csiDropped = 0;
  esp_wifi_set_promiscuous(true);
  esp_err_t e = esp_wifi_set_csi_config(&csi_config);
  if (e != ESP_OK) Serial.printf("{\"type\":\"err\",\"msg\":\"csi config failed: %s\"}\n", esp_err_to_name(e));
  esp_wifi_set_csi_rx_cb(&csi_cb, NULL);
  esp_wifi_set_csi(true);

  uint32_t csiTotal = 0;
  for (uint8_t k = 0; k < csiNumCh; k++) {
    uint8_t ch = csiChannels[k];
    e = esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
    uint32_t c0 = millis(), chPkts = 0, dropped0 = csiDropped;
    if (e != ESP_OK) {
      Serial.printf("{\"type\":\"err\",\"msg\":\"set channel %u failed: %s\"}\n", ch, esp_err_to_name(e));
      continue;
    }
    Serial.printf("{\"type\":\"session\",\"event\":\"csi_channel\",\"id\":%ld,\"ms\":%lu,\"ch\":%u,\"band\":\"%s\",\"dwell_ms\":%lu}\n",
                  id, (unsigned long)c0, ch, ch <= 14 ? "2.4" : "5", (unsigned long)csiDwellMs);
    while (millis() - c0 < csiDwellMs) {
      chPkts += drainCsi();
      pollCommands(id, true, CSI_PHASE_MS - (millis() - t1));
      delay(1);
    }
    chPkts += drainCsi();
    csiTotal += chPkts;
    Serial.printf("{\"type\":\"session\",\"event\":\"csi_channel_done\",\"id\":%ld,\"ms\":%lu,\"ch\":%u,\"pkts\":%lu,\"dropped\":%lu}\n",
                  id, (unsigned long)millis(), ch, (unsigned long)chPkts, (unsigned long)(csiDropped - dropped0));
  }

  esp_wifi_set_csi(false);
  esp_wifi_set_promiscuous(false);
  drainCsi();
  uint32_t t2 = millis();
  Serial.printf("{\"type\":\"session\",\"event\":\"done\",\"id\":%ld,\"ms\":%lu,\"rssi_scans\":%lu,\"csi_pkts\":%lu,"
                "\"csi_dropped\":%lu,\"dur_ms\":%lu}\n",
                id, (unsigned long)t2, (unsigned long)scans, (unsigned long)csiTotal,
                (unsigned long)csiDropped, (unsigned long)(t2 - t0));
}

// Use this for detecting AP MAC Address. Triggered by {"cmd":"strongest"}; never returns (reset to exit).
// Scans both bands; "ch" tells which band the strongest AP is on.
void doStrongestApLoop(long id) {
  Serial.printf("{\"type\":\"info\",\"msg\":\"Starting continuous scan loop for strongest AP\",\"id\":%ld}\n", id);

  while (true) {
    int n = WiFi.scanNetworks(false, true); // blocking active scan over 2.4 + 5 GHz, include hidden

    if (n > 0) {
      int best_rssi = -128;
      int best_idx = -1;

      // Find the AP with the highest RSSI
      for (int i = 0; i < n; i++) {
        if (WiFi.RSSI(i) > best_rssi) {
          best_rssi = WiFi.RSSI(i);
          best_idx = i;
        }
      }

      if (best_idx != -1) {
        String ssid = WiFi.SSID(best_idx);
        ssid.replace("\\", "\\\\");
        ssid.replace("\"", "\\\"");

        Serial.printf("{\"type\":\"strongest_ap\",\"mac\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d,\"ch\":%d}\n",
                      WiFi.BSSIDstr(best_idx).c_str(),
                      ssid.c_str(),
                      best_rssi,
                      WiFi.channel(best_idx));
      }
    } else {
      Serial.println("{\"type\":\"err\",\"msg\":\"No APs found in this cycle\"}");
    }

    WiFi.scanDelete();
    delay(2000);
  }
}

void setup() {
  Serial.begin(115200);
  csiQueue = xQueueCreate(32, sizeof(CsiPkt));   // 32 x ~640 B = ~20 KB
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_country_code(WIFI_COUNTRY, false);
  bandModeOk = WiFi.setBandMode(WIFI_BAND_MODE_AUTO);   // scan and tune on both 2.4 and 5 GHz
  delay(100);
  probeChannels();
  sendHello();
}

void loop() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  long id = parseId(line);
  if (line.indexOf("\"hello\"") >= 0) sendHello();
  else if (line.indexOf("\"scan\"") >= 0) doScan(id);
  else if (line.indexOf("\"strongest\"") >= 0) doStrongestApLoop(id);
}
