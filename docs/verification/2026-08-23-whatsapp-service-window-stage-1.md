# Janela de atendimento do WhatsApp — registro da etapa 1

Data do preparo local: 24 de agosto de 2026
Estado deste documento: **pré-deploy; evidências de produção pendentes**

Este registro acompanha a publicação da infraestrutura de janela de 24 horas, templates e consentimento restrito. Ele não declara que a etapa 1 já foi implantada. Os campos de produção só podem ser preenchidos com saídas sanitizadas obtidas na KVM durante a janela de publicação.

## Contrato funcional

- A janela fica aberta somente antes de `lastCustomerMessageAt + 24 horas` e encerra exatamente no limite.
- Fora da janela, texto livre e mídia são bloqueados no servidor quando o modo estiver `ACTIVE`.
- O template não reabre a janela; somente uma nova mensagem do cliente permite voltar a enviar mensagens livres.
- A retomada automática vale apenas para uma solicitação recebida e ainda não respondida pela empresa. Não vale para marketing, campanha, prospecção nem uma conversa já respondida.
- Opt-out ou **Não contatar** prevalece sobre qualquer solicitação anterior.
- Respostas enviadas pela central ou pelo WhatsApp Business no celular encerram a mesma pendência compartilhada por toda a empresa.

## Template externo obrigatório

Criar e submeter manualmente no Gerenciador do WhatsApp da Meta:

- nome técnico: `retomar_atendimento`;
- idioma: `pt_BR`;
- corpo: `Olá, {{1}}! A XP Eletrônicos está retomando o atendimento que você iniciou. Podemos continuar por aqui?`;
- formato suportado nesta etapa: texto com uma variável textual no corpo.

A aplicação não cria, aprova nem altera templates na Meta. Um administrador deve sincronizar a conta oficial, conferir `APPROVED`, `pt_BR`, texto e parâmetros, selecionar o template para `SERVICE_RESUMPTION` e verificar a prontidão. Até isso ocorrer, mantenha `WhatsAppPolicyConfiguration.mode=INACTIVE`.

## Gate local antes da KVM

- [ ] `npm run db:generate`
- [ ] `npm run db:validate`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev`
- [ ] `scripts/test-deployment.ps1`
- [ ] `scripts/verify-compose.ps1`
- [ ] `scripts/verify-kvm-deployment.ps1`
- [ ] revisão de privacidade e segredos
- [ ] `git diff --check` e árvore candidata limpa

## Auditoria obrigatória imediatamente antes do deploy

- [ ] registrar a revisão candidata e a revisão atualmente implantada;
- [ ] executar a auditoria dos trabalhos paralelos, branches e worktrees e integrar somente alterações relevantes, seguras e verificadas;
- [ ] registrar digest imutável da imagem candidata e da imagem de rollback compatível;
- [ ] capturar snapshot sanitizado de nomes, imagens, estados, health, redes e volumes de todos os containers;
- [ ] provar que o comando de publicação recria somente `xp-whatsapp-app`;
- [ ] criar backup verificável do banco e da mídia sem imprimir segredos;
- [ ] confirmar que DNS, Caddy, assinatura Meta, PostgreSQL, volumes, redes e containers non-app não serão alterados.

## Aceite de produção da etapa 1

Preencher somente após observação direta na KVM:

- revisão anterior: **pendente**
- revisão candidata: **pendente**
- digest candidato: **pendente**
- backup e teste de integridade: **pendente**
- migration aplicada uma vez e limpa: **pendente**
- health local e público: **pendente**
- modo confirmado como `INACTIVE`: **pendente**
- autenticação e permissões administrativas: **pendente**
- sincronização sem exposição de segredo: **pendente**
- mensagens, mídia, áudio recebido e enviado: **pendente**
- webhooks, `smb_message_echoes` e leitura compartilhada: **pendente**
- snapshot non-app antes/depois sem mudança: **pendente**

Não ative a etapa 2 apenas porque o código está saudável. Ela exige um template realmente aprovado, sincronizado e selecionado, além de validação manual com contato controlado.

## Falha e rollback

Se o start falhar, pare e classifique a falha; não repita automaticamente. Uma retomada `OUTCOME_UNKNOWN` nunca recebe retry cego. Primeiro desative a proteção, se necessário, e investigue webhook/auditoria.

O rollback de código recria somente `xp-whatsapp-app` com a imagem de compatibilidade previamente registrada. O schema aditivo, migrations e histórico permanecem. Não restaure ou recrie banco, Caddy, volumes, redes, assinatura Meta, DNS nem serviços paralelos sem nova autorização e um plano específico.
