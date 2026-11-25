/** AI 数据库注入令牌。宿主必须绑定同一已选中 Client；此类不会创建连接或生命周期。 */
import type { PrismaClient } from "@prisma/client";
export class PrismaService {}
export interface PrismaService extends PrismaClient {}
