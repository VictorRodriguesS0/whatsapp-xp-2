# Janela de atendimento do WhatsApp — registro da etapa 1

Data do preparo e implantação: 24 de agosto de 2026
Estado deste documento: **Etapa 1 implantada e verificada com política INACTIVE**

Este registro acompanha a publicação da infraestrutura de janela de 24 horas,
templates e consentimento restrito. As evidências abaixo foram obtidas de forma
sanitizada na KVM durante a implantação; nenhuma mensagem real foi enviada para
produzir evidência artificial.

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

- [x] `npm run db:generate`
- [x] `npm run db:validate`
- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm audit --omit=dev`
- [x] `scripts/test-deployment.ps1`
- [x] `scripts/verify-compose.ps1`
- [x] `scripts/verify-kvm-deployment.ps1`
- [x] revisão de privacidade e segredos
- [x] `git diff --check` e árvore candidata limpa

Evidência local em 24 de agosto de 2026, após integrar exatamente a revisão
`2c5d7504d3cdb31e3657fa0f357939a7f82ec92a` então ativa em produção:

- 178 arquivos de teste e 1.620 testes aprovados;
- 2 arquivos e 3 testes opcionais ignorados pelas flags existentes;
- 304 testes focados de mutações, webhook, realtime, banco, políticas e retomadas;
- schema Prisma válido e 20 migrações aplicadas na base local isolada;
- build Next.js de produção com 31 páginas;
- zero vulnerabilidades em dependências de produção;
- os três validadores de deploy aprovados em processos isolados;
- nenhuma credencial Meta rastreada e nenhuma variável sensível exposta como
  `NEXT_PUBLIC_*`;
- o único padrão semelhante a token encontrado pertence ao schema comprimido
  gerado pelo Prisma, não a uma credencial.

A Release 2 de sincronização de edições/exclusões foi auditada enquanto ainda
estava em execução paralela, publicada isoladamente, verificada e depois
integrada à candidata no commit de merge `1703f39`. O relatório de produção
correspondente também foi incorporado por equivalência de patch.

## Auditoria obrigatória imediatamente antes do deploy

- [ ] registrar a revisão candidata e a revisão atualmente implantada;
- [ ] executar a auditoria dos trabalhos paralelos, branches e worktrees e integrar somente alterações relevantes, seguras e verificadas;
- [ ] registrar digest imutável da imagem candidata e da imagem de rollback compatível;
- [ ] capturar snapshot sanitizado de nomes, imagens, estados, health, redes e volumes de todos os containers;
- [ ] provar que o comando de publicação recria somente `xp-whatsapp-app`;
- [ ] criar backup verificável do banco e da mídia sem imprimir segredos;
- [ ] confirmar que DNS, Caddy, assinatura Meta, PostgreSQL, volumes, redes e containers non-app não serão alterados.

## Aceite de produção da etapa 1

- revisão anterior: `2c5d7504d3cdb31e3657fa0f357939a7f82ec92a`;
- revisão implantada: `6d67be6fc674450c35cb5756a0609f387a47cf12`;
- imagem imutável:
  `xp-whatsapp:6d67be6fc674450c35cb5756a0609f387a47cf12`;
- ID da imagem:
  `sha256:51bdcbe68d4d2c0d8200a64fe22e0bb80ba7a8923b5f2ca0e70cd9cc3bedc962`;
- novo app:
  `36ffe74e8f10b97ff3f501a2bd8983efe2ef567ea14fd95d1767636e99a3a02a`,
  saudável e com zero reinícios;
- banco preservado:
  `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`,
  iniciado em `2026-08-22T23:57:15.699997655Z`, saudável e sem reinício;
- backup preventivo validado:
  `/srv/backups/example-app/example-backup`;
- cópia do ambiente anterior:
  `/opt/apps/example-app/.env.production.backup`;
- 20 migrations concluídas, zero incompletas e zero revertidas; a migration da
  Etapa 1 foi aplicada uma única vez;
- `WhatsAppPolicyConfiguration`: `INACTIVE`, versão `0`, sincronização `NEVER`;
- health local, health público e login: HTTP 200;
- conversa anônima: redirecionada; API administrativa anônima e webhook com
  assinatura inválida: HTTP 401;
- rota e página administrativas autenticadas: HTTP 200, `canActivate=false`;
  a sessão temporária de verificação foi apagada e deixou zero registro;
- três amostras separadas por 20 segundos: HTTP 200, app `running/healthy`,
  zero reinícios e zero marcadores fatais;
- assinatura Meta somente leitura preservada em Graph `v23.0`, com os mesmos 12
  campos e hash sanitizado
  `9244942a020917c2efc5706692179a35ed32a9e3edc8d557104ce817bec898e7`;
- os 29 containers não-app produziram snapshot canônico idêntico antes/depois,
  SHA-256
  `7d14b56d325169e35b442e4df19efe3d41634b7219a91211d2ad1e9ccc91d365`;
- a imagem anterior foi preservada como rollback imediato;
- teste funcional real de mensagem, mídia e áudio: **não executado neste
  rollout**, para não gerar comunicação artificial; permanece disponível para
  teste manual controlado;
- webhooks, `smb_message_echoes` e leitura compartilhada: assinatura preservada
  e regressões automatizadas aprovadas; nenhum evento real foi provocado neste
  rollout.

Não ative a etapa 2 apenas porque o código está saudável. Ela exige um template realmente aprovado, sincronizado e selecionado, além de validação manual com contato controlado.

## Falha e rollback

Se o start falhar, pare e classifique a falha; não repita automaticamente. Uma retomada `OUTCOME_UNKNOWN` nunca recebe retry cego. Primeiro desative a proteção, se necessário, e investigue webhook/auditoria.

O rollback de código recria somente `xp-whatsapp-app` com a imagem de compatibilidade previamente registrada. O schema aditivo, migrations e histórico permanecem. Não restaure ou recrie banco, Caddy, volumes, redes, assinatura Meta, DNS nem serviços paralelos sem nova autorização e um plano específico.
