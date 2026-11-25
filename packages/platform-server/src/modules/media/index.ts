/** 有界媒体字节解析。调用者先完成业务授权和受控读取，本出口不访问模型、数据库或对象存储。 */
export { inspectBoundedImage } from "./bounded-image";
export { inspectPcmWav } from "./pcm-wav";
export { BoundedMediaReadError, createBoundedMediaReader, readBoundedMedia } from "./media-reader";
export type { BoundedMediaReadErrorCode } from "./media-reader";
