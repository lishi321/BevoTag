# BevoTag DAQ ↔ collector serial protocol (v1)

The contract between the ESP32 DAQ module and the survey collector web app. It's a proposal: the DAQ team
can change it, but bump `v` and update `app.js` to match.

## Transport

- USB serial (native USB CDC or a USB-UART bridge), **115200 baud, 8N1**
- UTF-8 text, one line per message, ending in `\n` (`\r\n` is fine)
- **The app saves every line to its CSV log**, whatever the format. It only acts on the
  `hello`, `scan` and `err` messages below, so debug prints are fine.

## Commands (app → device)

| Command | Meaning | Reply |
|---|---|---|
| `{"cmd":"hello"}` | identify yourself | one `hello` |
| `{"cmd":"scan","id":17}` | do one full WiFi scan now | one `scan` echoing `id` |

The app sends `hello` about 1.5 s after opening the port, because the board may reset on open. During
Collect it sends `scan`, waits for the reply (20 s timeout) and repeats.

**Streaming mode:** if the device scans continuously on its own, tick "Device streams scans" in the app.
It then stops sending `scan` commands and uses each incoming `scan` message while collecting.

## Messages the app reads (device → app)

### `hello`
```json
{"type":"hello","v":1,"fw":"0.1.0","chip":"ESP32-C6","mac":"a0:b1:c2:d3:e4:f5"}
```
`mac` is the station MAC, so the data shows which radio took it. Extra fields (scan settings, sensors
fitted…) are welcome. They end up in the CSV with the rest of the line.

### `scan`
```json
{"type":"scan","v":1,"id":17,"seq":42,"ms":123456,"dur_ms":2140,
 "aps":[
   {"bssid":"70:10:5c:aa:bb:01","ssid":"utexas","rssi":-58,"ch":6},
   {"bssid":"70:10:5c:aa:bb:02","ssid":"utexas-iot","rssi":-59,"ch":6},
   {"bssid":"70:10:5c:aa:bb:10","ssid":"","rssi":-81,"ch":149}
 ]}
```

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `"scan"` |
| `aps` | yes | array, may be empty |
| `aps[].bssid` | yes | `aa:bb:cc:dd:ee:ff`, any case |
| `aps[].rssi` | yes | integer dBm |
| `aps[].ssid` | no | `""` for hidden networks |
| `aps[].ch` | no | primary channel |
| `id` | no | echo of the command's `id` |
| `seq` | no | device-side scan counter |
| `ms` | no | `millis()` when the scan finished |
| `dur_ms` | no | how long the scan took |

### `err`
```json
{"type":"err","msg":"scan failed: -2"}
```
Optional. The app shows it, and during Collect it retries that scan.

## Everything else (IMU, CSI, …)

Send whatever you like; it lands in the CSV untouched. To make analysis easy:
- Send one JSON object per line with a `"type"` field, e.g. `{"type":"imu","ms":…,"ax":…}`.
  The app copies `type` into its own CSV column, so filtering by it is one line in pandas.
- Include a device timestamp (`ms`). The laptop's `host_time` includes USB buffering delay.
- Watch the bandwidth: 115200 baud is about 11 KB/s, shared with scan replies. Boards with native
  USB (ESP32-C3/C6/S3) aren't limited by the baud rate.

## Scanning guidance (important for fingerprint quality)

- **Report every BSSID and don't dedupe by SSID.** UT access points broadcast several SSIDs
  (utexas, utexas-iot, eduroam, utguest…), each with its own BSSID. All of them are useful features.
- Use an **active scan over all channels** with a fixed per-channel dwell time, and keep the
  settings the same for the whole survey. Put the settings in `hello`/`fw` so we can tell data sets apart.
- Raise the result cap. The ESP-IDF default AP record buffer can truncate busy areas,
  so ask `esp_wifi_scan_get_ap_num()` for the count and allocate that many records.
- The ESP32-C6/C3/S3 only see 2.4 GHz. The ESP32-C5 also sees 5 GHz, which would likely
  help room-level separation (5 GHz attenuates more through walls).
- Survey with the **same board, antenna and enclosure** as the final tag if possible.

## Minimal Arduino-ESP32 sketch

```cpp
#include <WiFi.h>
uint32_t seq = 0;

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
```
(The string matching is good enough for a bench sketch. Use a real JSON parser such as ArduinoJson in the real firmware.)
