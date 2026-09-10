# Reconexão oficial da Meta — Implementation Plan

> For agentic workers: executar inline com executing-plans. Plano aprovado pelo usuário em 10/09/2026. Implementação inline e revisão independente conforme a skill requesting-code-review.

**Goal:** mostrar a conexão real e permitir reconectar o número existente pelo Embedded Signup oficial de coexistência.

**Architecture:** estado de conexão no MetaHealthSnapshot; tentativas temporárias vinculadas ao administrador e à sessão; troca imediata do código no servidor; confirmação independente pela Graph API; interface em /configuracoes/meta.

**Tech Stack:** Next.js, React, TypeScript, Prisma/PostgreSQL, Meta Graph API, Facebook JavaScript SDK, Vitest.

## Global Constraints

- Manter os IDs e a credencial permanente configurados no servidor. Rejeitar outros ativos. Nunca persistir ou registrar código OAuth ou token temporário.
- Não substituir a tela de políticas /configuracoes/whatsapp nem alterar automaticamente a versão da API de mensagens.
- Não registrar/desregistrar o número, importar histórico ou reenviar mensagens antigas automaticamente.
- QR e código de acesso pertencem ao fluxo oficial da Meta. Novo onboarding desvincula aparelhos adicionais; a interface deve informar esse efeito antes de abrir o fluxo.
- Configuração e elegibilidade na Meta são requisitos externos. Botão permanece indisponível sem configuração explícita.

## Execução

- [x] Estado de conexão, migração aditiva, consultas Graph e eventos de ciclo de vida com ordenação temporal.
- [x] Bloqueio de novas tentativas de envio durante desconexão confirmada, preservando idempotência e leituras.
- [x] Tentativas autenticadas com expiração, exclusão mútua, proteção contra repetição, troca de código e validação dos ativos.
- [x] Integração Embedded Signup v4 na tela existente, mensagens de progresso, cancelamento e recuperação de consulta.
- [x] Testes de regressão, banco, tipos, lint, build e navegador.
- [x] Documentação de configuração, implantação, reversão e pendências externas verificadas.

## Fontes oficiais

- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update/
