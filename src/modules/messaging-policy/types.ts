export type ServiceWindowDto = {
  enforcement: "INACTIVE" | "ACTIVE";
  status: "OPEN" | "CLOSED";
  closesAt: string | null;
  sendMode:
    | "FREE_FORM"
    | "RESUMPTION"
    | "AWAITING_CUSTOMER"
    | "CONFIRMING"
    | "BLOCKED";
  reason:
    | "NO_CUSTOMER_MESSAGE"
    | "WINDOW_EXPIRED"
    | "NO_PENDING_REQUEST"
    | "CONTACT_OPTED_OUT"
    | "TEMPLATE_UNAVAILABLE"
    | null;
  resumption: {
    templateName: string;
    language: string;
    previewBody: string;
  } | null;
};

export type ServiceWindowCalculation = {
  status: "OPEN" | "CLOSED";
  closesAt: Date | null;
};
