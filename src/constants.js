export const MQTT_URL = 'wss://mqtt.testing02.svc.netology-group.services/mqtt';
export const SVC_AUDIENCE = 'testing02.svc.netology-group.services';
export const CONFERENCE_ACCOUNT_ID = `conference.${SVC_AUDIENCE}`;
export const CONFERENCE_AGENT_ID = `alpha.${CONFERENCE_ACCOUNT_ID}`;
export const EVENT_ACCOUNT_ID = `event.${SVC_AUDIENCE}`;
export const USR_AUDIENCE = 'testing02.usr.foxford.ru';
export const VIDEO_CONSTRAINTS_REGULAR = { width: 320, height: 240 };
export const VIDEO_CONSTRAINTS_PIN = { width: 1280, height: 720 };
export const CONSTRAINTS = { audio: true, video: VIDEO_CONSTRAINTS_REGULAR };
export const VIDEO_REMBS = { pin: 1000000, regular: 200000 };

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
