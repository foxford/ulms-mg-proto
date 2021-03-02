# Minigroup prototype app

```bash
npm install
npm run build
```

Open `index.html?room_id=ROOM_ID&agent_label=AGENT_LABEL&mqtt_password=MQTT_PASSWORD`
in your browser where:
* `ROOM_ID` is an opened conference room ID in `testing01.foxford.ru` audience with `owned` RTC sharing policy;
* `AGENT_LABEL` is a base64 encoded gid of user on `ulms-dev01.foxford.ru`;
* `MQTT_PASSWORD` is JWT token for this account (can be generated using svc-authn-cli tool).
