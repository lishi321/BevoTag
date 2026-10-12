#include <WiFi.h>
#include <esp_wifi.h>

uint32_t seq = 0;

// Structure to track channel signal strengths across the 50 scans
struct ChannelStats {
  int channel;
  int32_t max_rssi;
  uint32_t hits;
};

// Callback function triggered whenever a packet containing CSI is received
void csi_cb(void *ctx, wifi_csi_info_t *info) {
  if (!info || !info->buf || info->len == 0) return;

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

// void doScan(long id) {
//   uint32_t t0 = millis();
//   const int TOTAL_SCANS = 50;

//   // Track channels 1 to 14 in 2.4 GHz
//   ChannelStats ch_stats[15];
//   for (int c = 0; c <= 14; c++) {
//     ch_stats[c].channel = c;
//     ch_stats[c].max_rssi = -120;
//     ch_stats[c].hits = 0;
//   }

//   Serial.printf("{\"type\":\"info\",\"msg\":\"Starting 50 RSSI scan iterations...\",\"id\":%ld}\n", id);

//   // Phase 1: 50 Scan Iterations
//   for (int scan_idx = 0; scan_idx < TOTAL_SCANS; scan_idx++) {
//     uint32_t scan_start = millis();
//     int n = WiFi.scanNetworks(false, true); // blocking active scan, include hidden

//     if (n < 0) {
//       Serial.printf("{\"type\":\"err\",\"msg\":\"scan iteration %d failed: %d\"}\n", scan_idx, n);
//       delay(50);
//       continue;
//     }

//     Serial.printf("{\"type\":\"scan_iter\",\"id\":%ld,\"iter\":%d,\"seq\":%lu,\"ms\":%lu,\"dur_ms\":%lu,\"aps\":[",
//                   id, scan_idx + 1, ++seq, millis(), millis() - scan_start);

//     for (int i = 0; i < n; i++) {
//       String ssid = WiFi.SSID(i); 
//       ssid.replace("\\", "\\\\"); 
//       ssid.replace("\"", "\\\"");
//       int ch = WiFi.channel(i);
//       int rssi = WiFi.RSSI(i);

//       Serial.printf("%s{\"bssid\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d,\"ch\":%d}",
//                     i ? "," : "", WiFi.BSSIDstr(i).c_str(), ssid.c_str(), rssi, ch);

//       // Track channel metrics
//       if (ch >= 1 && ch <= 14) {
//         ch_stats[ch].hits++;
//         if (rssi > ch_stats[ch].max_rssi) {
//           ch_stats[ch].max_rssi = rssi;
//         }
//       }
//     }
//     Serial.print("]}\n");
//     WiFi.scanDelete();

//     delay(20); // brief yield to feed watchdog
//   }

//   // Find the top 4 strongest unique channels based on max observed RSSI
//   int target_channels[4] = {0};
//   int channel_count = 0;

//   for (int slot = 0; slot < 4; slot++) {
//     int best_ch = -1;
//     int32_t best_rssi = -128;

//     for (int c = 1; c <= 14; c++) {
//       if (ch_stats[c].hits > 0 && ch_stats[c].max_rssi > best_rssi) {
//         // Ensure channel wasn't already picked
//         bool already_selected = false;
//         for (int s = 0; s < slot; s++) {
//           if (target_channels[s] == c) {
//             already_selected = true;
//             break;
//           }
//         }
//         if (!already_selected) {
//           best_rssi = ch_stats[c].max_rssi;
//           best_ch = c;
//         }
//       }
//     }

//     if (best_ch != -1) {
//       target_channels[channel_count++] = best_ch;
//     }
//   }

//   if (channel_count == 0) {
//     Serial.printf("{\"type\":\"err\",\"msg\":\"No APs found during 50 scans\"}\n");
//     return;
//   }

//   // Phase 2: Lock and Sniff CSI
//   Serial.printf("{\"type\":\"info\",\"msg\":\"50 scans completed in %lums. Starting CSI sniff on %d channels (2 min each)\"}\n",
//                 millis() - t0, channel_count);

//   WiFi.disconnect();
//   esp_wifi_set_promiscuous(true);

//   // Configure CSI collection
//   wifi_csi_config_t csi_config;
//   csi_config.lltf_en = true;
//   csi_config.htltf_en = true;
//   csi_config.stbc_htltf2_en = true;
//   csi_config.ltf_merge_en = true;
//   csi_config.channel_filter_en = true;
//   csi_config.manu_scale = false;
//   csi_config.shift = false;
//   esp_wifi_set_csi_config(&csi_config);

//   esp_wifi_set_csi_rx_cb(&csi_cb, NULL);
//   esp_wifi_set_csi(true);

//   // Dwell 2 minutes per channel
//   for (int i = 0; i < channel_count; i++) {
//     int ch = target_channels[i];
//     esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
//     Serial.printf("{\"type\":\"info\",\"msg\":\"Sniffing channel %d...\"}\n", ch);

//     uint32_t dwell_start = millis();
//     while (millis() - dwell_start < 120000) {
//       delay(10);
//     }
//   }

//   // Cleanup
//   esp_wifi_set_csi(false);
//   esp_wifi_set_promiscuous(false);
//   Serial.printf("{\"type\":\"info\",\"msg\":\"Scan sequence complete. Waiting for next command.\"}\n");
// }

// Use this for detecting AP MAC Address  
void doScan(long id) {
  Serial.printf("{\"type\":\"info\",\"msg\":\"Starting continuous scan loop for strongest AP\",\"id\":%ld}\n", id);
  
  // Infinite loop as requested
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
    
    // Mandatory delay to prevent the FreeRTOS watchdog timer from crashing the ESP32
    delay(2000); 
  }
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