import { score } from "./engine/score";
self.onmessage = (e) => {
  try {
    self.postMessage({
      revision: e.data.revision,
      certificate: score(e.data.graph, e.data.values),
    });
  } catch (error) {
    self.postMessage({ revision: e.data.revision, error: String(error) });
  }
};
