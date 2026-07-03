import { proxyToBackend } from "../deployment.config.js";

export default {
  fetch(request) {
    return proxyToBackend(request);
  }
};