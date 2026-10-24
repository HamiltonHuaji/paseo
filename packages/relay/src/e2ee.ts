export {
  createClientChannel,
  createDaemonChannel,
  EncryptedChannel,
  encodeEncryptedFrame,
} from "./encrypted-channel.js";
export type {
  Transport,
  TransportMessage,
  EncryptedChannelEvents,
  EncryptedFrameEncoder,
  EncryptedFrameRequest,
} from "./encrypted-channel.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportSecretKey,
  importSecretKey,
} from "./crypto.js";
export type { KeyPair, SharedKey } from "./crypto.js";
