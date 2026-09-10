import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { ResourceDownloadService } from "../../../../services/resource-download";
import { agentResources } from "../../../../services/resources";
import { createLogger } from "../../../../platform/logger";

const log = createLogger("agent-download");
const service = new ResourceDownloadService(nativeFetch, agentResources, error => log.warn("Download resource cleanup failed", error));
export const downloadResource = service.download.bind(service);
