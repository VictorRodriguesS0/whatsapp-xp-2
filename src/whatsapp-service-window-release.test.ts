import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const serverOnlyMetaVariables = [
  "META_APP_ID",
  "META_APP_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
] as const;

describe("WhatsApp service-window release", () => {
  it("ships persistence, enforcement, provider, administration and attendant UX together", () => {
    expect(
      source(
        "prisma/migrations/202608230003_whatsapp_service_window_templates/migration.sql",
      ),
    ).toContain("CREATE TABLE whatsapp_policy_configuration");
    expect(source("src/modules/messages/service.ts")).toContain(
      "assertFreeFormSendAllowed",
    );
    expect(source("src/modules/messaging-policy/service.ts")).toContain(
      "WHATSAPP_SERVICE_WINDOW_CLOSED",
    );
    expect(source("src/modules/whatsapp/provider.ts")).toContain(
      "listTemplates(): Promise<ProviderTemplate[]>",
    );
    expect(source("src/modules/whatsapp/provider.ts")).toContain(
      "sendTemplate(input: TemplateSendInput)",
    );
    expect(source("src/app/configuracoes/whatsapp/page.tsx")).toContain(
      "WhatsAppPolicyScreen",
    );
    expect(
      source("src/app/api/conversations/[id]/resumptions/route.ts"),
    ).toContain("resumeConversation");
    expect(
      source("src/app/api/contacts/[id]/messaging-restriction/route.ts"),
    ).toContain("setContactMessagingRestriction");
    expect(source("src/components/inbox/conversation-view.tsx")).toContain(
      "ServiceWindowBanner",
    );
  });

  it("keeps every Meta credential server-only in both deployment targets", () => {
    const envExample = source(".env.example");
    const dockerfile = source("Dockerfile");
    const composeFiles = [
      source("docker-compose.yml"),
      source("deploy/kvm/docker-compose.yml"),
    ];

    expect(envExample).not.toMatch(
      /^NEXT_PUBLIC_.*(?:TOKEN|SECRET|BUSINESS_ACCOUNT|PHONE_NUMBER_ID)/m,
    );
    expect(dockerfile).not.toMatch(
      /^ARG\s+.*(?:TOKEN|SECRET|BUSINESS_ACCOUNT|PHONE_NUMBER_ID)/im,
    );

    for (const variable of serverOnlyMetaVariables) {
      expect(envExample).toContain(`${variable}=`);
      for (const compose of composeFiles) {
        expect(compose).toContain(`${variable}: \${${variable}:-}`);
        expect(compose).not.toContain(`NEXT_PUBLIC_${variable}`);
      }
    }

    expect(source("scripts/verify-compose.ps1")).toContain(
      "Meta credentials must remain server-only",
    );
    expect(source("scripts/verify-kvm-deployment.ps1")).toContain(
      "Meta credentials must remain server-only",
    );
  });

  it("documents fail-closed activation, exact template and app-only rollback", () => {
    const operations = [
      source("README.md"),
      source(
        "docs/verification/2026-08-23-whatsapp-service-window-stage-1.md",
      ),
    ].join("\n");

    expect(operations).toContain(
      "Olá, {{1}}! A XP Eletrônicos está retomando o atendimento que você iniciou. Podemos continuar por aqui?",
    );
    expect(operations).toContain("pt_BR");
    expect(operations).toContain("INACTIVE");
    expect(operations).toContain("não repita automaticamente");
    expect(operations).toContain("schema aditivo");
    expect(operations).toContain("somente `xp-whatsapp-app`");
    expect(operations).toContain("auditoria dos trabalhos paralelos");
  });
});
