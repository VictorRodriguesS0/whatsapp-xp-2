# Player de áudio estilo WhatsApp — verificação de produção

## Escopo publicado

- Revisão funcional: `4d1c2e3dcf7ee898c88c38e2e8841aa8b5ffa05b`.
- Base de produção preservada antes da implementação: `bdb6d758b8dc4439a2d3688d4b484a9488107a03`.
- Player próprio para áudios recebidos e enviados, mantendo `/api/media/<id>` como fonte autenticada.
- Duração e posição no formato `atual / total`, barra visual e seek acessível.
- Reprodução exclusiva entre todos os áudios da conversa e a prévia de gravação.
- Velocidades `1×`, `1,5×` e `2×`, com preferência da sessão e aplicação no próximo play.
- Motor `<audio>` oculto, controles de 44 px, estados de erro e foco preservados.

## Integração com trabalhos paralelos

Imediatamente antes do deploy, a produção ainda estava na revisão integrada `bdb6d758b8dc4439a2d3688d4b484a9488107a03`, já incorporada ao candidato. A auditoria encontrou trabalhos posteriores de catálogo, alertas de templates e acabamento responsivo em branches separadas; o trabalho de catálogo também continha arquivos não commitados. Nenhum deles estava ativo em produção e nenhum foi incluído parcialmente. Assim, a publicação preservou a produção vigente sem substituir nem misturar funcionalidades paralelas incompletas.

## Build e testes

- Imagem de produção: `xp-whatsapp:4d1c2e3dcf7ee898c88c38e2e8841aa8b5ffa05b`.
- Image ID: `sha256:eab51c028822c07732253879e5159e9dae8309aa522fb8632100aed31a1cbb96`.
- Label OCI `org.opencontainers.image.revision` igual à revisão funcional.
- Runtime como `1001:1001`, com `ffmpeg`, `ffprobe` e `pdftoppm`; fontes e testes não foram enviados ao runtime.
- `npm run lint`: aprovado.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado, Next.js 16.3.1 e 32 rotas.
- Testes focados e de integração do áudio: 113 aprovados.
- Suíte integral contra PostgreSQL 18 descartável: 199 arquivos aprovados, 2 ignorados; 1.732 testes aprovados, 3 ignorados.
- `scripts/test-deployment.ps1`: aprovado.
- `scripts/verify-kvm-deployment.ps1`: aprovado.
- Objetos Docker temporários de teste removidos após a execução.

## Backup e rollout

- Backup validado: `/srv/backups/example-app/example-backup`.
- `database.dump` e `media.tar.gz` aprovados pelos respectivos SHA-256.
- Backup do ambiente anterior: `/opt/apps/example-app/.env.production.backup`.
- Somente `xp-whatsapp-app` foi recriado; a candidata foi promovida apenas depois do healthcheck.
- Container do app: `997c3cb7a4610357a8908fc2bcf2d33b8b9f9175969b99b39ea4e6335391a2ef`.
- Container do banco preservado: `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`, mesmo `StartedAt`, saudável e zero reinícios.
- Hash do snapshot de todos os contêineres não app antes e depois: `55aa5656063051a98e2b89e8f3f77cc36998ed2654625801c6d29897af885465`.
- Redes do app: `shared_gateway`, `xp_whatsapp_egress` e `xp_whatsapp_internal`.
- Migrações: 20 aplicadas, zero falhas e nenhuma pendente.
- `current` e `XP_WHATSAPP_IMAGE` apontam para a revisão funcional.
- `https://whatsapp.xpeletronicos.com/api/health`: HTTP 200 com `{"status":"ok"}`.
- Logs de inicialização: nenhuma migration pendente e Next.js pronto; app saudável, zero reinícios.

## Aceitação no navegador autenticado

Uma conversa já lida com cinco áudios reais foi usada para evitar alteração de pendências. Após recarregar a aplicação:

- os cinco players exibiram controles próprios, barra de posição e velocidade;
- os metadados carregaram durações reais, incluindo `0:00 / 0:08` no primeiro áudio;
- ao tocar o primeiro áudio, somente ele ficou em reprodução;
- ao tocar o segundo, o primeiro foi pausado automaticamente;
- `1,5×` foi exibido em todos os players e aplicado ao áudio no próximo play;
- a preferência foi devolvida a `1×` e todos os áudios ficaram pausados ao fim;
- o navegador não registrou erros no console.

## Rollback preservado

A imagem anterior `xp-whatsapp:bdb6d758b8dc4439a2d3688d4b484a9488107a03`, o release anterior e o backup do ambiente foram mantidos. Como não há migration nova nesta entrega, o rollback é app-only e compatível com o schema atual.
