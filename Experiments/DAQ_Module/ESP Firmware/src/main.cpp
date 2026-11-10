#include <WiFi.h>
#include <esp_wifi.h>
#include <freertos/queue.h>

// ---------------------------------------------------------------- session settings
// One {"cmd":"scan"} runs a full capture session:
//   Phase 1 (RSSI): repeated active scans over all channels, each sent as a PROTOCOL.md "scan" message
//   Phase 2 (CSI):  promiscuous CSI capture, hopping through every 2.4 GHz channel
static const uint32_t RSSI_PHASE_MS = 3UL * 60 * 1000;   // 3 min
static const uint32_t CSI_PHASE_MS  = 5UL * 60 * 1000;   // 5 min, split evenly across CSI channels
static const uint8_t  CSI_FIRST_CH  = 1;
static const uint8_t  CSI_LAST_CH   = 13;                // 1-13 (receive-only, so 12/13 are fine to sniff)
static const uint8_t  CSI_NUM_CH    = CSI_LAST_CH - CSI_FIRST_CH + 1;
static const uint32_t CSI_DWELL_MS  = CSI_PHASE_MS / CSI_NUM_CH;  // ~23 s per channel

uint32_t seq = 0;

// ---------------------------------------------------------------- CSI capture
// The WiFi driver calls csi_cb from its own task, so it must be fast: it only copies the packet into a
// queue. The main loop prints queued packets. Packets that arrive while the queue is full are counted as dropped.
static const uint16_t CSI_MAX_LEN = 384;   // LLTF + HT-LTF + STBC HT-LTF, the largest the S3 produces
struct CsiPkt {
  uint32_t ms;          // millis() at receive
  uint32_t ts_us;       // radio timestamp (us)
  uint8_t  mac[6];
  int8_t   rssi;
  int8_t   noise;
  uint8_t  ch;
  uint8_t  ch2;         // secondary channel: 0 none, 1 above, 2 below
  uint8_t  sig_mode;    // 0 non-HT (11bg), 1 HT (11n)
  uint8_t  cwb;         // 0 20 MHz, 1 40 MHz
  uint8_t  first_invalid;
  uint16_t len;
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
  p.ch2 = info->rx_ctrl.secondary_channel;
  p.sig_mode = info->rx_ctrl.sig_mode;
  p.cwb = info->rx_ctrl.cwb;
  p.first_invalid = info->first_word_invalid;
  p.len = info->len > CSI_MAX_LEN ? CSI_MAX_LEN : info->len;
  memcpy(p.data, info->buf, p.len);
  if (xQueueSend(csiQueue, &p, 0) != pdTRUE) csiDropped++;
}

// Print every queued CSI packet as one JSON line. Returns how many were printed.
static uint32_t drainCsi() {
  static CsiPkt p;
  static char line[96 + CSI_MAX_LEN * 5];
  uint32_t n = 0;
  while (xQueueReceive(csiQueue, &p, 0) == pdTRUE) {
    int o = snprintf(line, sizeof line,
      "{\"type\":\"csi\",\"ms\":%lu,\"ts_us\":%lu,\"mac\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"rssi\":%d,\"noise\":%d,"
      "\"ch\":%u,\"ch2\":%u,\"sig_mode\":%u,\"cwb\":%u,\"first_invalid\":%u,\"len\":%u,\"data\":[",
      (unsigned long)p.ms, (unsigned long)p.ts_us, p.mac[0], p.mac[1], p.mac[2], p.mac[3], p.mac[4], p.mac[5],
      p.rssi, p.noise, p.ch, p.ch2, p.sig_mode, p.cwb, p.first_invalid, p.len);
    for (uint16_t i = 0; i < p.len; i++) o += snprintf(line + o, sizeof line - o, i ? ",%d" : "%d", p.data[i]);
    o += snprintf(line + o, sizeof line - o, "]}\n");
    Serial.write((const uint8_t *)line, o);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- messages
void sendHello() {
  Serial.printf("{\"type\":\"hello\",\"v\":1,\"fw\":\"0.2.0\",\"chip\":\"%s\",\"mac\":\"%s\","
                "\"rssi_phase_ms\":%lu,\"csi_phase_ms\":%lu,\"csi_ch\":\"%u-%u\",\"csi_dwell_ms\":%lu}\n",
                ESP.getChipModel(), WiFi.macAddress().c_str(),
                (unsigned long)RSSI_PHASE_MS, (unsigned long)CSI_PHASE_MS, CSI_FIRST_CH, CSI_LAST_CH,
                (unsigned long)CSI_DWELL_MS);
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

// One active scan over all channels, sent as a PROTOCOL.md v1 "scan" message
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

  // Phase 1: RSSI. Keep scanning until 3 min have passed (the scan in progress finishes, so it can run ~3 s over).
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
  wifi_csi_config_t csi_config = {};
  csi_config.lltf_en = true;
  csi_config.htltf_en = true;
  csi_config.stbc_htltf2_en = true;
  csi_config.ltf_merge_en = true;
  csi_config.channel_filter_en = true;
  csi_config.manu_scale = false;
  csi_config.shift = 0;

  xQueueReset(csiQueue);
  csiDropped = 0;
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_csi_config(&csi_config);
  esp_wifi_set_csi_rx_cb(&csi_cb, NULL);
  esp_wifi_set_csi(true);

  uint32_t csiTotal = 0;
  for (uint8_t ch = CSI_FIRST_CH; ch <= CSI_LAST_CH; ch++) {
    esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
    uint32_t c0 = millis(), chPkts = 0, dropped0 = csiDropped;
    Serial.printf("{\"type\":\"session\",\"event\":\"csi_channel\",\"id\":%ld,\"ms\":%lu,\"ch\":%u,\"dwell_ms\":%lu}\n",
                  id, (unsigned long)c0, ch, (unsigned long)CSI_DWELL_MS);
    while (millis() - c0 < CSI_DWELL_MS) {
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
void doStrongestApLoop(long id) {
  Serial.printf("{\"type\":\"info\",\"msg\":\"Starting continuous scan loop for strongest AP\",\"id\":%ld}\n", id);

  while (true) {
    int n = WiFi.scanNetworks(false, true); // blocking active scan, include hidden

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

        Serial.printf("{\"type\":\"strongest_ap\",\"mac\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d}\n",
                      WiFi.BSSIDstr(best_idx).c_str(),
                      ssid.c_str(),
                      best_rssi);
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
  csiQueue = xQueueCreate(32, sizeof(CsiPkt));   // 32 x ~410 B = ~13 KB
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
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
