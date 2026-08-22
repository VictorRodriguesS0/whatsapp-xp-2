export type PublicErrorOperation =
  | "login"
  | "list"
  | "load-more"
  | "conversation"
  | "send"
  | "retry"
  | "responsible"
  | "unread"
  | "contact-tags"
  | "contact-tag-save";

const fallback: Record<PublicErrorOperation, string> = {
  login: "Não foi possível entrar agora. Tente novamente.",
  list: "Não foi possível carregar as conversas.",
  "load-more": "Não foi possível carregar conversas anteriores.",
  conversation: "Não foi possível carregar a conversa.",
  send: "Não foi possível enviar a mensagem.",
  retry: "Não foi possível reenviar a mensagem.",
  responsible: "Não foi possível alterar o responsável.",
  unread: "Não foi possível marcar como não lida.",
  "contact-tags": "Não foi possível carregar as etiquetas.",
  "contact-tag-save": "Não foi possível salvar as etiquetas.",
};

export function publicErrorMessage(operation: PublicErrorOperation, status?: number, network = false) {
  if (operation === "login" && status === 401) return "E-mail ou senha inválidos.";
  if (operation === "login" && status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (status === 429) return "Muitas solicitações. Aguarde um momento e tente novamente.";
  if (operation === "login" && network) return "Sem conexão. Confira sua rede e tente novamente.";
  return fallback[operation];
}
