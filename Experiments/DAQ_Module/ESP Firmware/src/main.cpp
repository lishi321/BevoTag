#include <WiFi.h>
#include <esp_wifi.h>

uint32_t seq = 0;

// Callback function triggered whenever a packet containing CSI is received
void csi_cb(void *ctx, wifi_csi_info_t *info) {
  if (!info || !info->buf || info->len == 0) return;

  // Print the CSI data as a JSON object
  Serial.printf("{\"type\":\"csi\",\"mac\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"rssi\":%d,\"len\":%d,\"data\":[",
                info->mac[0], info->mac[1], info->mac[2], info->mac[3], info->mac[4], info->mac[5],
                info->rx_ctrl.rssi, info->len);

  int8_t *csi_data = (int8_t *)info->buf;
  for (int i = 0; i < info->len; i++) {
    Serial.printf("%d%s", csi_data[i], (i == info->len - 1) ? "" : ",");
  }
  Serial.print("]}\n");
}

void sendHello() {
  Serial.printf("{\"type\":\"hello\",\"v\":1,\"fw\":\"0.1.0\",\"chip\":\"%s\",\"mac\":\"%s\"}\n",
                ESP.getChipModel(), WiFi.macAddress().c_str());
}

void doScan(long id) {
  uint32_t t0 = millis();
  
  // Phase 1: Standard Active Scan
  int n = WiFi.scanNetworks(false, true); // blocking, include hidden
  if (n < 0) { 
    Serial.printf("{\"type\":\"err\",\"msg\":\"scan failed: %d\"}\n", n); 
    return; 
  }
  
  Serial.printf("{\"type\":\"scan\",\"v\":1,\"id\":%ld,\"seq\":%lu,\"ms\":%lu,\"dur_ms\":%lu,\"aps\":[",
                id, ++seq, millis(), millis() - t0);
  
  // Array to hold up to 4 unique channels
  int target_channels[4] = {0};
  int channel_count = 0;

  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i); ssid.replace("\\", "\\\\"); ssid.replace("\"", "\\\"");
    int ch = WiFi.channel(i);
    
    Serial.printf("%s{\"bssid\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d,\"ch\":%d}",
                  i ? "," : "", WiFi.BSSIDstr(i).c_str(), ssid.c_str(), WiFi.RSSI(i), ch);
                  
    // Check if we already added this channel to our list
    bool is_duplicate = false;
    for (int j = 0; j < channel_count; j++) {
      if (target_channels[j] == ch) {
        is_duplicate = true;
        break;
      }
    }
    // If it's a new channel and we haven't hit our limit of 4, save it
    if (!is_duplicate && channel_count < 4) {
      target_channels[channel_count] = ch;
      channel_count++;
    }
  }
  Serial.print("]}\n");
  WiFi.scanDelete();

  if (channel_count == 0) {
     Serial.printf("{\"type\":\"err\",\"msg\":\"No APs found to sniff\"}\n");
     return;
  }

  // Phase 2: Lock and Sniff
  Serial.printf("{\"type\":\"info\",\"msg\":\"Starting CSI sniff on %d channels for 2 mins each\"}\n", channel_count);
  
  WiFi.disconnect();
  esp_wifi_set_promiscuous(true); // Must be enabled to capture raw packets

  // Configure CSI collection
  wifi_csi_config_t csi_config;
  csi_config.lltf_en = true;
  csi_config.htltf_en = true;
  csi_config.stbc_htltf2_en = true;
  csi_config.ltf_merge_en = true;
  csi_config.channel_filter_en = true;
  csi_config.manu_scale = false;
  csi_config.shift = false;
  esp_wifi_set_csi_config(&csi_config);
  
  esp_wifi_set_csi_rx_cb(&csi_cb, NULL);
  esp_wifi_set_csi(true);

  // Loop through target channels
  for (int i = 0; i < channel_count; i++) {
    int ch = target_channels[i];
    esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
    Serial.printf("{\"type\":\"info\",\"msg\":\"Sniffing channel %d...\"}\n", ch);
    
    // Dwell for 2 minutes (120,000 milliseconds)
    // We use a while loop with a small delay so the hardware watchdog doesn't crash the ESP
    uint32_t dwell_start = millis();
    while (millis() - dwell_start < 120000) {
      delay(10); 
    }
  }

  // Clean up: Disable CSI and Promiscuous mode to prepare for the next command
  esp_wifi_set_csi(false);
  esp_wifi_set_promiscuous(false);
  Serial.printf("{\"type\":\"info\",\"msg\":\"Sniffing complete. Waiting for next command.\"}\n");
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  sendHello();
}

void loop() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  if (line.indexOf("\"hello\"") >= 0) sendHello();
  else if (line.indexOf("\"scan\"") >= 0) {
    int k = line.indexOf("\"id\":");
    doScan(k >= 0 ? line.substring(k + 5).toInt() : -1);
  }
}