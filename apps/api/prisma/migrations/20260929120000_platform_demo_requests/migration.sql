-- 平台级官网演示预约。仅新增表，不修改现有租户或客户记录。
CREATE TABLE `platform_demo_requests` (
    `id` VARCHAR(36) NOT NULL,
    `requestKey` VARCHAR(36) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `contactType` VARCHAR(16) NOT NULL,
    `contactValue` VARCHAR(160) NOT NULL,
    `company` VARCHAR(120) NOT NULL DEFAULT '',
    `message` TEXT NOT NULL,
    `language` VARCHAR(8) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `platform_demo_requests_requestKey_key` (`requestKey`),
    INDEX `platform_demo_requests_createdAt_id_idx` (`createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
