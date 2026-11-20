# Can a laptop host the BevoTag location server on UT campus Wi-Fi?

*Research note for the System Design Report (due Dec 4, 2026). Prepared Nov 19, 2026 from public UT pages only. No scans or probes of the campus network were run.*

## Short answer

| Network | Can a team laptop act as the location server? | Why |
|---|---|---|
| `utexas` | **No, not as a practical or clearly permitted design.** | The laptop gets a non-public address, and the default "Protected" profile blocks all unsolicited inbound connections. Switching to "Unprotected" opens the laptop to the whole campus but still gives no internet access. ECE IT says running your own web services locally needs Information Security Office (ISO) consent. Also, the ESP32 can't join `utexas` at all, because `utexas` has no 2.4 GHz service. |
| `utexas-iot` | **No for the server. Yes for the tags as clients.** | Same addressing and profile model. `utexas-iot` exists so devices like the tag can connect as ordinary clients, not so they can host services for others. |
| Laptop reachable from tags *across* `utexas` ↔ `utexas-iot` | **Unclear (unverified).** | The Unprotected profile says "all devices on the campus network" can reach the device. No UT page says whether `utexas-iot` clients are routed to `utexas` clients. |

**Recommendation:** run the location server on a **cloud VM** (or a managed app platform) with a public HTTPS endpoint. The ESP32 tags stay on `utexas-iot` with the default Protected profile and make **outbound** HTTPS posts to it. That keeps the tag an "ordinary network client," as the Project Definition promises, and it needs no exception from UT. Use laptops only for development (localhost) and for offline replay of logged scans.

---

## 1. Authentication and device registration

**`utexas`** (people's network)
- WPA2/WPA3-Enterprise (802.1X). Users log in with their UT EID. EAP is PEAP or TTLS with MSCHAPv2 inner auth, and the server certificate is `dot1x.utexas.edu`. Source: UT ITS KB0010997, *Connecting to utexas Wi-Fi* (v23, modified 2026-09-01), https://ut.service-now.com/kb_view.do?sysparm_article=KB0010997
- **2.4 GHz is not supported on `utexas`; devices need 5 or 6 GHz** (same KB). The ESP32 has only a 2.4 GHz radio, so it can't use `utexas`. That settles `utexas-iot` as the tag network.
- Policy: students, faculty, staff, and official visitors "must access the campus wireless network using the encrypted network, 'utexas'." Source: ITS, *Management of UTnet Wireless Access Policy* (last revised May 2018), https://tech.utexas.edu/sites/default/files/documents/management-of-utnet-wireless-access-policy.pdf. This document predates `utexas-iot`.

**`utexas-iot`** (device network)
- WPA2-PSK with AES. The device's MAC address is registered on the Network Portal (network.utexas.edu) by someone with an active EID. MAC randomization must be turned off. Source: UT ITS KB0017215, *Connecting to utexas-iot Wi-Fi* (v10, modified 2025-08-25), https://ut.service-now.com/kb_view.do?sysparm_article=KB0017215; and KB0019068, *MAC Address Randomization* (modified 2026-05-05), https://ut.service-now.com/kb_view.do?sysparm_article=KB0019068
- **The key is per EID, not per device.** Devices registered before Dec 20, 2021 got unique per-device keys. Later registrations "will have the same key for all devices for that EID" (KB0017215). Keys are 16- or 20-digit numbers. Resetting a key means re-registering every device under that EID.
  - *Implication:* all tags registered by one team member share that member's key, and that member is accountable for the devices. The wording "per-device pre-shared key" should be avoided in our reports. The Project Definition's phrase "the WPA2 pre-shared key that utexas-iot issues" is still accurate.
- No device-count limit or key expiry is stated. *Unverified:* ask the ITS Service Desk if the team will register more than a handful of tags.

## 2. Addressing and NAT

- Both KBs say the same thing: "connected devices are not assigned publicly accessible IP addresses" (KB0010997 for `utexas`, KB0017215 for `utexas-iot`). **A laptop on either network can't be reached from the internet**, so phones on cellular data or off-campus users can't connect to it.
- *Unverified:* whether the addresses are RFC 1918 private space routed across campus (the Unprotected profile wording suggests campus-wide reachability), whether NAT is applied only at the internet edge, DHCP lease length, and whether a device keeps the same address between sessions or buildings. No UT page found documents DHCP or address stability. **Design assumption: addresses are not stable.** Nothing in BevoTag should hard-code a campus IP. To confirm, ask ITS Networking (networking@its.utexas.edu).

## 3. Client isolation and inbound connections

- UT's "General Networks" use per-device **network security profiles**, set through MAC registration at network.utexas.edu. Source: UT ITS KB0020221, *Network Security Profiles for General Networks* (v3, modified 2026-08-04), https://ut.service-now.com/kb_view.do?sysparm_article=KB0020221. KB0017215 links to it for `utexas-iot` registrations.
  - **Protected (default):** blocks "all unsolicited connection attempts to your device," like having a dedicated firewall. Two Protected devices can't open connections to each other.
  - **Unprotected:** "allows all traffic inbound to and outbound from your device to the campus network." It is intended for printers, consoles, NAS, and similar devices. KB0020221 warns that "all devices on the campus network will be able to reach it."
- The Engineering IT wiki confirms this practice: Unprotected "can open your device to network attacks from other campus systems." Source: https://cloud.wikis.utexas.edu/wiki/spaces/engritgpublic/pages/81169393/Networking+-+Register+a+device+as+Unprotected (updated 2022). Engineering IT also says standard UT wired connections have a firewall that "blocks most inbound connections." Source: https://cloud.wikis.utexas.edu/wiki/spaces/engritgpublic/pages/81169120/Networking+-+Wired+connections (updated 2025-09-04).
- **Bottom line:** by default, no device can reach a laptop server on campus Wi-Fi. With the laptop set to Unprotected, other campus devices *probably* can, but internet clients still can't.
- *Unverified:* whether a `utexas-iot` device can reach an Unprotected `utexas` laptop, or the reverse. The policy text says "campus network" but doesn't name the SSIDs. To confirm, ask ITS Networking. Don't test it with scans.

## 4. Policy on running servers and network equipment

- **ECE IT:** university policy "prohibits any individual or group from running their own web services locally". This covers machines in a "lab, assigned workspace," and running them requires "the consent of the Information Security Office." Source: ECE IT wiki, *Web Publishing and Hosting*, https://cloud.wikis.utexas.edu/wiki/spaces/eceit/pages/37754680/Web+Publishing+and+Hosting. This is the most direct statement found, and it applies to a laptop serving the BevoTag web app or API to others.
- **Acceptable Use Policy for students** (rev. 2019-08-28), https://security.utexas.edu/policies/aup:
  - §5.2: users may not extend access to university information resources to others without permission, e.g., proxy services.
  - §4.3: disproportionate use includes, for example, serving a multi-user game.
  - §5.12: devices must run security software, and a device "may be immediately disconnected" without notice.
- **Information Resources Use and Security Policy** (amended 2015-07-16), https://security.utexas.edu/policies/irusp:
  - Standard 2: users shall never use university resources to "circumvent University computer security measures," and remote access must use an approved method.
  - Standard 1.4.3: approval is required for deploying new systems or services, explicitly including IoT devices.
  - Standard 4.2.3: ISO monitors for and disables rogue wireless access points. *This clause was read from a summary, not verbatim; check the exact text before quoting it.*
- **Wireless Access Policy** (2018, link above): "Individuals and departments are prohibited from extending university networks through means of wireless technologies." Exceptions, such as "a wireless research group's experimenting with isolated wireless devices," may be granted in writing by ITS Networking (networking@its.utexas.edu).
- **IoT-specific rules:** besides registration, KB0017215 says applications that need publicly accessible IPs are not supported on `utexas-iot`. No page found says outright "no servers on utexas-iot." The ECE web-services rule and IRUSP 1.4.3 cover the case anyway.
- *Could not read:* KB0011684, *University IT Policies Regarding Public Network Access* (requires UT login), and the Network Operations Manual (old link returns 404). A team member can read KB0011684 while logged in, since it may be the most specific rule on this question.

## 5. Options, ranked for a student project

1. **Cloud VM or managed app platform, with ESP32 tags posting outbound over HTTPS: recommended.**
   - Fit: the tag stays an ordinary client on Protected `utexas-iot`. Phones and laptops anywhere can open the web map. No UT exception is needed, and nothing depends on campus addressing.
   - Costs: a small VM is enough for fingerprint matching at our scale. Watch the per-month cost and keep credentials out of the public repo (use environment variables or a secrets store). Tags need TLS. The ESP32 supports HTTPS/MQTT over TLS, which costs some RAM and power, so this should be noted in the power budget.
   - *Unverified:* that `utexas-iot` allows outbound TCP 443 (and 8883 if we choose MQTT) to arbitrary hosts. This is very likely, since IoT devices commonly call cloud services, but confirm on the first tag bring-up by checking normal client behavior. Ask ITS if it fails.
2. **UT- or ECE-provided server.**
   - The ECE LRC Linux application servers (RHEL 8, SSH, VPN required off-campus; https://cloud.wikis.utexas.edu/wiki/spaces/eceit/pages/37752870) are compute hosts for students. Nothing says they may run persistent public listeners, and the ECE web-hosting rule above points the other way.
   - No ECE VM offering for senior design was found. ECE's paid data-center hosting is for departmental hardware.
   - *Action:* email ECE IT (help@ece.utexas.edu) and ask whether a senior-design project can get a VM or an approved service with a campus-reachable or public endpoint. If yes, it competes with option 1 on cost. Its endpoint would still need to be reachable from `utexas-iot` and from phones.
3. **Outbound tunnel (Cloudflare Tunnel, ngrok, Tailscale) to a team laptop.**
   - Technically this works around the inbound block. However, it uses a personal laptop to publish a service through UT's network without ISO consent, which conflicts with the ECE web-services rule. It also arguably runs into AUP §5.2 (proxy/extending access) and IRUSP Standard 2 (circumventing security measures).
   - Tailscale also needs a client on every device, and there is no mature Tailscale client for the ESP32.
   - **Don't rely on it.** At most, use it for short demos with ISO/ECE approval, and say so in the report.
4. **Laptop with the Unprotected profile on campus Wi-Fi.**
   - Campus-only, with no stable address and no internet access. It needs ISO consent for local web services, and it exposes the laptop to the whole campus. Reaching it from `utexas-iot` is also unverified.
   - Acceptable only for a bench test with explicit approval.
5. **Private access point or hotspot in the lab.**
   - Bridging it into UTnet is prohibited by the Wireless Access Policy. An *isolated* AP (no UTnet uplink, e.g., a travel router with only the laptop and tags on it) is the kind of case the policy says needs a written exception from ITS Networking. Note that ISO hunts rogue APs.
   - A phone hotspot on cellular data doesn't extend UTnet. *Whether it counts as a "rogue AP" is unverified.*
   - It also isn't representative of the deployed system: tags must scan campus APs for fingerprinting but would associate with the hotspot.
   - **Last resort for an isolated lab demo, only after asking networking@its.utexas.edu.**

## Recommended architecture for EE 464

```
ESP32 tag ──(utexas-iot, Protected, outbound HTTPS/TLS)──► cloud location server ◄──(HTTPS)── phones / laptops (any network)
                                                          │  fingerprint DB + fusion
                                                          └─ serves the 3D campus map web app
```

- The tag joins `utexas-iot` under one team member's EID, with MAC randomization off and the default Protected profile. It only opens outbound connections.
- The location server and web app run in one cloud VM or container behind HTTPS, using a domain or provider-assigned hostname.
- Laptops run the same server locally for development, and for replaying scan logs when the network is unavailable.
- In the System Design Report, list "where the server runs" as decided: cloud. Cite KB0010997, KB0017215, KB0020221, the ECE web-hosting rule, and the AUP. List the unverified items below as open questions.

## Open questions and how to confirm them

| Question | Status | Who to ask |
|---|---|---|
| Is `utexas-iot` routed to `utexas` clients (Unprotected case)? | Unverified | ITS Networking, networking@its.utexas.edu |
| DHCP lease length and address stability on `utexas` / `utexas-iot` | Unverified | ITS Networking |
| Outbound ports allowed from `utexas-iot` (443, 8883) | Unverified, very likely open | Confirm on first tag bring-up; else ITS Service Desk |
| Contents of KB0011684, *University IT Policies Regarding Public Network Access* | Not read (login required) | Any team member logged into ut.service-now.com |
| Device limits per EID on `utexas-iot` | Not stated | ITS Service Desk |
| ECE VM / approved service for senior design | Not offered on the wiki | ECE IT, help@ece.utexas.edu |
| Exact IRUSP 4.2.3 rogue-AP wording; whether an isolated hotspot needs an exception | Partly verified | ISO (security.utexas.edu) / ITS Networking |
