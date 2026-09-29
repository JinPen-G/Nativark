import type { DemoRequestListQuery, DemoRequestPage } from "@rental-os/shared";
import { request } from "./http";

export const demoRequestsApi = {
  list(query: DemoRequestListQuery) {
    return request<DemoRequestPage>("/platform/demo-requests", { params: query });
  }
};
