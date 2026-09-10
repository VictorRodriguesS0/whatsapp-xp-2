import "server-only";

import { WhatsAppProviderError } from "./meta-provider";
import type { WhatsAppProvider } from "./provider";

export function withConnectionGuard(provider: WhatsAppProvider, guard: () => Promise<void>): WhatsAppProvider {
  function guarded<Args extends unknown[], Result>(call: (...args: Args) => Promise<Result>) {
    return async (...args: Args): Promise<Result> => {
      try { await guard(); } catch {
        // No transport call has started, so this is a definite local rejection.
        throw new WhatsAppProviderError("rejected", "Integração indisponível antes do envio", "LOCAL_CONNECTION_UNAVAILABLE");
      }
      return call(...args);
    };
  }
  return {
    sendText: guarded(provider.sendText.bind(provider)),
    sendTemplate: guarded(provider.sendTemplate.bind(provider)),
    sendMedia: guarded(provider.sendMedia.bind(provider)),
    uploadMedia: guarded(provider.uploadMedia.bind(provider)),
    sendProduct: guarded(provider.sendProduct.bind(provider)),
    sendProductList: guarded(provider.sendProductList.bind(provider)),
    sendCatalog: guarded(provider.sendCatalog.bind(provider)),
    sendReaction: guarded(provider.sendReaction.bind(provider)),
    markRead: guarded(provider.markRead.bind(provider)),
    listTemplates: provider.listTemplates.bind(provider),
    getMediaMetadata: provider.getMediaMetadata.bind(provider),
    downloadMedia: provider.downloadMedia.bind(provider),
  };
}
