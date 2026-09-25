# BevoTag DAQ ↔ Collector serial protocol (v1)

This is the contract between the ESP32 DAQ module and the EER survey collector web app.
It's a proposal: change it if the DAQ team needs to, but bump `v` and update `app.js` when you do.

## Transport

- USB serial (CDC or USB-UART bridge), **115200 baud, 8N1**
- UTF-8 text, **one JSON object per line**, terminated by `\n` (`\r\n` is fine too)
- Any line that isn't valid JSON is shown in the app's serial log and otherwise ignored,
  so ordinary debug `printf`s are OK. Just don't start a debug line with `{`.

## Host → device commands

| Command | Meaning | Expected reply |
|---|---|---|
| `{"cmd":"hello"}` | Identify yourself | one `hello` message |
| `{"cmd":"scan","id":17}` | Do one full WiFi scan now | one `scan` message echoing `id` |

The app sends `hello` about 1.5 s after it opens the port (the board may reset on open).
While collecting, it sends one `scan` command, waits for the reply (timeout 20 s), and repeats.

**Streaming mode:** if the device just scans continuously on its own, tick "Device streams scans"
in the app. It will then stop sending `scan` commands and save each incoming `scan` message while collecting.

## Device → host messages

### `hello`
```json
{"type":"hello","v":1,"fw":"0.1.0","chip":"ESP32-C6","mac":"a0:b1:c2:d3:e4:f5"}
```
`mac` is the station MAC. It's recorded with every sample so we know which radio took the data.

### `scan`
```json
{"type":"scan","v":1,"id":17,"seq":42,"ms":123456,"dur_ms":2140,
 "aps":[
   {"bssid":"70:10:5c:aa:bb:01","ssid":"utexas","rssi":-58,"ch":6},
   {"bssid":"70:10:5c:aa:bb:02","ssid":"utexas-iot","rssi":-59,"ch":6},
   {"bssid":"70:10:5c:aa:bb:10","ssid":"","rssi":-81,"ch":149}
 ]}
```

| Field | Req. | Notes |
|---|---|---|
| `type` | yes | `"scan"` |
| `aps` | yes | array, may be empty |
| `aps[].bssid` | yes | `aa:bb:cc:dd:ee:ff`, any case |
| `aps[].rssi` | yes | integer dBm |
| `aps[].ssid` | no | `""` for hidden networks |
| `aps[].ch` | no | primary channel |
| `id` | no | echo of the command `id`, if one was sent |
| `seq` | no | device-side scan counter |
| `ms` | no | `millis()` when the scan finished |
| `dur_ms` | no | how long the scan took |

### `err` (optional)
```json
{"type":"err","msg":"scan failed: -2"}
```
The app logs it. During collection it also retries that scan.

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
