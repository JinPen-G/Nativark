/** Default zero-Core Web entry: no AI settings supplied. */
import { createPublicAdminApp } from "./App";
import { mountPublicAdmin } from "./main";

mountPublicAdmin(createPublicAdminApp());
