export const MQTT_URL = 'wss://mqtt.testing01.svc.netology-group.services/mqtt';
export const SVC_AUDIENCE = 'testing01.svc.netology-group.services';
export const CONFERENCE_ACCOUNT_ID = `conference.${SVC_AUDIENCE}`;
export const CONFERENCE_AGENT_ID = `alpha.${CONFERENCE_ACCOUNT_ID}`;
export const USR_AUDIENCE = 'testing01.usr.foxford.ru';
export const CONSTRAINTS = { audio: true, video: { width: 320, height: 240 } };

export const ICE_SERVERS = [
  {
    urls: ["stun:stun.staging01.netology-group.services:3478"]
  },
  {
    urls: ["turn:turn.staging01.netology-group.services:3478"],
    username: "ntg",
    credential: "password"
  }
];
