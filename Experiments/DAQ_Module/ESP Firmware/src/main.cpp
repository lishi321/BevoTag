#include <WiFi.h>
#include <esp_wifi.h>

uint32_t seq = 0;

// Callback function triggered whenever a packet containing CSI is received
void csi_cb(void *ctx, wifi_csi_info_t *info) {
  if (!info || !info->buf || info->len == 0) return;

  // Print the CSI data as a JSON object to match your existing format
  Serial.printf("{\"type\":\"csi\",\"mac\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"rssi\":%d,\"len\":%d,\"data\":[",
                info->mac[0], info->mac[1], info->mac[2], info->mac[3], info->mac[4], info->mac[5],
                info->rx_ctrl.rssi, info->len);

  // The CSI buffer contains raw In-Phase (I) and Quadrature (Q) values
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
  int n = WiFi.scanNetworks(false, true);          // blocking, include hidden
  if (n < 0) { Serial.printf("{\"type\":\"err\",\"msg\":\"scan failed: %d\"}\n", n); return; }
  
  Serial.printf("{\"type\":\"scan\",\"v\":1,\"id\":%ld,\"seq\":%lu,\"ms\":%lu,\"dur_ms\":%lu,\"aps\":[",
                id, ++seq, millis(), millis() - t0);
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i); ssid.replace("\\", "\\\\"); ssid.replace("\"", "\\\"");
    Serial.printf("%s{\"bssid\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d,\"ch\":%d}",
                  i ? "," : "", WiFi.BSSIDstr(i).c_str(), ssid.c_str(), WiFi.RSSI(i), WiFi.channel(i));
  }
  Serial.print("]}\n");
  WiFi.scanDelete();
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  // 1. Enable CSI collection
  esp_wifi_set_csi(true);
  
  // 2. Configure which parts of the preamble to extract
  wifi_csi_config_t csi_config;
  csi_config.lltf_en = true;
  csi_config.htltf_en = true;
  csi_config.stbc_htltf2_en = true;
  csi_config.ltf_merge_en = true;
  csi_config.channel_filter_en = true;
  csi_config.manu_scale = false;
  csi_config.shift = false;
  esp_wifi_set_csi_config(&csi_config);
  
  // 3. Register the callback function
  esp_wifi_set_csi_rx_cb(&csi_cb, NULL);

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