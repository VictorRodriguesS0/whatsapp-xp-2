"use client";

import { ExternalLink, MapPin } from "lucide-react";
import type { ReactNode } from "react";

import type { InboxMessage } from "@/hooks/use-inbox";
import type { MessageDto } from "@/modules/conversations/types";
import {
  parseMessageContent,
  type MessageContent,
} from "@/modules/messages/content";

type ContentOfKind<Kind extends MessageContent["kind"]> = Extract<
  MessageContent,
  { kind: Kind }
>;

const richCardClass =
  "min-w-0 overflow-hidden rounded-md border border-[var(--rich-border)] bg-[var(--rich-surface)] p-3 text-[var(--text)]";

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className={richCardClass}
      data-reply-swipe-ignore="true"
    >
      {children}
    </section>
  );
}

function LocationCard({ content }: { content: ContentOfKind<"location"> }) {
  const coordinates = `${content.latitude}, ${content.longitude}`;
  const query = new URLSearchParams({
    api: "1",
    query: `${content.latitude},${content.longitude}`,
  });

  return (
    <Card label="Localização compartilhada">
      <div className="flex min-w-0 items-start gap-2">
        <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0">
          <h3 className="break-words font-semibold">
            {content.name ?? "Localização compartilhada"}
          </h3>
          {content.address ? (
            <p className="mt-1 break-words text-sm text-[var(--muted)]">
              {content.address}
            </p>
          ) : null}
          <p className="mt-1 break-words text-xs tabular-nums text-[var(--muted)]">
            {coordinates}
          </p>
        </div>
      </div>
      <a
        className="mt-3 inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-md border border-[var(--rich-border)] px-3 text-center text-sm font-semibold text-[var(--accent)] outline-none hover:bg-[var(--rich-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        href={`https://www.google.com/maps/search/?${query.toString()}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span>Abrir no Google Maps</span>
        <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
      </a>
    </Card>
  );
}

function ContactsCard({ content }: { content: ContentOfKind<"contacts"> }) {
  const heading = content.contacts.length === 1
    ? "Contato compartilhado"
    : "Contatos compartilhados";

  return (
    <Card label={heading}>
      <h3 className="font-semibold">{heading}</h3>
      <ul className="mt-2 space-y-2">
        {content.contacts.map((contact, contactIndex) => (
          <li
            className="min-w-0 border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0"
            key={`${contact.name}:${contactIndex}`}
          >
            <p className="break-words font-medium">{contact.name}</p>
            {contact.phones.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {contact.phones.map((phone, phoneIndex) => (
                  <li className="flex min-w-0 flex-wrap gap-x-2 text-sm" key={`${phone.phone}:${phoneIndex}`}>
                    <span className="break-all">{phone.phone}</span>
                    {phone.type ? (
                      <span className="text-[var(--muted)]">{phone.type}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-[var(--muted)]">Sem telefone informado</p>
            )}
          </li>
        ))}
      </ul>
      {content.truncated ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Alguns contatos não foram exibidos.
        </p>
      ) : null}
    </Card>
  );
}

function InteractiveCard({ content }: { content: ContentOfKind<"interactive"> }) {
  const heading = content.interaction === "button"
    ? "Resposta de botão"
    : "Resposta de lista";

  return (
    <Card label={heading}>
      <h3 className="font-semibold">{heading}</h3>
      <p className="mt-1 break-words">{content.title}</p>
    </Card>
  );
}

function OrderCard({ content }: { content: ContentOfKind<"order"> }) {
  return (
    <Card label="Pedido recebido">
      <h3 className="font-semibold">Pedido recebido</h3>
      <p className="mt-1 text-[var(--muted)]">
        {content.productCount} {content.productCount === 1 ? "produto" : "produtos"}
      </p>
    </Card>
  );
}

function SystemCard({ content }: { content: ContentOfKind<"system"> }) {
  return (
    <Card label="Atualização do WhatsApp">
      <h3 className="font-semibold">Atualização do WhatsApp</h3>
      {content.text ? <p className="mt-1 break-words">{content.text}</p> : null}
    </Card>
  );
}

const knownUnknownTypeLabels: Partial<Record<string, string>> = {
  reaction: "reação",
};

function UnknownCard({ rawType }: { rawType?: string }) {
  const typeLabel = rawType ? knownUnknownTypeLabels[rawType] : undefined;
  const copy = typeLabel
    ? `Mensagem do tipo ${typeLabel} ainda não disponível`
    : "Mensagem ainda não disponível.";

  return (
    <Card label="Mensagem não disponível">
      <h3 className="break-words font-semibold">{copy}</h3>
    </Card>
  );
}

const structuredTypes = new Set<InboxMessage["type"]>([
  "LOCATION",
  "CONTACTS",
  "INTERACTIVE",
  "ORDER",
  "SYSTEM",
]);

export function MessageRichContent({ message }: { message: InboxMessage }) {
  const content = parseMessageContent(message.content);

  if (message.type === "LOCATION" && content?.kind === "location") {
    return <LocationCard content={content} />;
  }
  if (message.type === "CONTACTS" && content?.kind === "contacts") {
    return <ContactsCard content={content} />;
  }
  if (message.type === "INTERACTIVE" && content?.kind === "interactive") {
    return <InteractiveCard content={content} />;
  }
  if (message.type === "ORDER" && content?.kind === "order") {
    return <OrderCard content={content} />;
  }
  if (message.type === "SYSTEM" && content?.kind === "system") {
    return <SystemCard content={content} />;
  }
  if (message.type === "UNSUPPORTED") {
    return <UnknownCard rawType={content?.kind === "unknown" ? content.rawType : undefined} />;
  }
  if (structuredTypes.has(message.type)) {
    return (
      <p data-reply-swipe-ignore="true" role="status">
        Conteúdo desta mensagem indisponível.
      </p>
    );
  }
  return null;
}

export function richMessagePreview(message: MessageDto): string | null {
  const content = parseMessageContent(message.content);

  switch (message.type) {
    case "STICKER":
      return "Figurinha";
    case "LOCATION":
      return "Localização";
    case "CONTACTS":
      return "Contato compartilhado";
    case "INTERACTIVE":
      return content?.kind === "interactive" ? content.title : "Resposta interativa";
    case "ORDER":
      return "Pedido recebido";
    case "SYSTEM":
      return "Atualização do WhatsApp";
    case "UNSUPPORTED":
      return "Mensagem não compatível";
    default:
      return null;
  }
}
