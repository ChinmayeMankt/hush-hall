// Choices offered at sign-up, shared by the form and the server check.
export { AVATARS } from "./profile"; // emoji avatars (no photos)
export const LAMP_COLORS_SIGNUP = ["#e9d8a6", "#d4a373", "#ccd5ae", "#b7c4cf", "#e6ccb2", "#c9ada7"]; // same soft lamp colours as the halls (no red)

// A friendly starting nickname so sign-up needs one less decision (people can change it).
const NICK_A = ["Quiet", "Sleepy", "Cosy", "Calm", "Gentle", "Steady", "Bright", "Soft", "Kind", "Lucky"]; // adjectives
const NICK_B = ["Owl", "Otter", "Panda", "Fox", "Tortoise", "Heron", "Koala", "Sparrow", "Lynx", "Moth"]; // animals
export const suggestNickname = () => `${NICK_A[Math.floor(Math.random() * NICK_A.length)]} ${NICK_B[Math.floor(Math.random() * NICK_B.length)]}`; // e.g. "Cosy Otter"
