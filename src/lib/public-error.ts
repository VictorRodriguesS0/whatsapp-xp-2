export type PublicErrorOperation =
  | "login"
  | "list"
  | "load-more"
  | "conversation"
  | "send"
  | "retry"
  | "reaction"
  | "reaction-unknown"
  | "responsible"
  | "pin"
  | "unread"
  | "contact-types"
  | "contact-type-save"
  | "contact-tags"
  | "contact-tag-save"
  | "contact-consent-save"
  | "whatsapp-policy"
  | "whatsapp-policy-save"
  | "resumption";

const fallback: Record<PublicErrorOperation, string> = {
  login: "Não foi possível entrar agora. Tente novamente.",
  list: "Não foi possível carregar as conversas.",
  "load-more": "Não foi possível carregar conversas anteriores.",
  conversation: "Não foi possível carregar a conversa.",
  send: "Não foi possível enviar a mensagem.",
  retry: "Não foi possível reenviar a mensagem.",
  reaction: "Não foi possível atualizar a reação.",
  "reaction-unknown": "A confirmação da reação ainda está pendente.",
  responsible: "Não foi possível alterar o responsável.",
  pin: "Não foi possível atualizar a fixação da conversa.",
  unread: "Não foi possível marcar como não lida.",
  "contact-types": "Não foi possível carregar os tipos de contato.",
  "contact-type-save": "Não foi possível atualizar o tipo de contato.",
  "contact-tags": "Não foi possível carregar as etiquetas.",
  "contact-tag-save": "Não foi possível salvar as etiquetas.",
  "contact-consent-save":
    "Não foi possível salvar o consentimento. Confira os dados e tente novamente.",
  "whatsapp-policy": "Não foi possível carregar a configuração do WhatsApp.",
  "whatsapp-policy-save": "Não foi possível atualizar a configuração do WhatsApp.",
  resumption: "Não foi possível retomar esta conversa.",
};

const whatsappDomainCopy: Record<string, string> = {
  WHATSAPP_SERVICE_WINDOW_CLOSED:
    "A janela de 24 horas terminou. Use a retomada aprovada.",
  WHATSAPP_TEMPLATE_NOT_READY:
    "O modelo aprovado ainda não está pronto para uso.",
  WHATSAPP_TEMPLATE_NOT_ELIGIBLE:
    "O modelo selecionado não pode ser usado para retomada.",
  WHATSAPP_TEMPLATE_SYNC_FAILED:
    "Não foi possível sincronizar os modelos com a Meta.",
  WHATSAPP_RESUMPTION_ALREADY_STARTED:
    "Esta solicitação já foi respondida ou retomada.",
  WHATSAPP_CONTACT_OPTED_OUT:
    "Este contato está marcado como não contatar.",
  WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN:
    "O envio pode ter ocorrido. Confirme no WhatsApp antes de tentar novamente.",
};

export function publicErrorMessage(
  operation: PublicErrorOperation,
  status?: number,
  network = false,
  code?: string,
) {
  if (code && whatsappDomainCopy[code]) return whatsappDomainCopy[code];
  if (operation === "login" && status === 401) return "E-mail ou senha inválidos.";
  if (operation === "login" && status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (status === 429) return "Muitas solicitações. Aguarde um momento e tente novamente.";
  if (operation === "login" && network) return "Sem conexão. Confira sua rede e tente novamente.";
  return fallback[operation];
}
