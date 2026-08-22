# Mensagens recebidas enriquecidas — verificação de produção

## Release

- Commit implantado: `2bf3ed35c1555bb0b5088e4766b3b72eba35db6b`.
- Imagem imutável: `xp-whatsapp:2bf3ed3`.
- Digest implantado: `sha256:7be26420178d539635d6868bdb022fd75914ac4fb83f6f21e07b201447bac518`.
- Release anterior preservada para rollback: `e8b9cff8f17aba03b7d877d28a0a965d75d07ddf`.
- Backup validado antes da implantação: `/srv/backups/example-app/example-backup`.

Antes do build final, a release concorrente `e8b9cff8f17aba03b7d877d28a0a965d75d07ddf`, que adicionou atribuição de tipos de contato, foi incorporada ao candidato. O conflito único na lista de conversas foi resolvido preservando tanto os tipos de contato quanto as prévias das novas mensagens.

## Verificações automatizadas

- Prisma generate, validate e deploy: aprovados.
- ESLint e TypeScript: aprovados.
- Build Next.js de produção no Windows e no builder Linux: aprovados.
- Auditoria de dependências de produção: zero vulnerabilidades.
- Validadores Compose, mutações de deployment e KVM: aprovados.
- Suíte final Linux: 98 arquivos aprovados, 2 integrações opt-in ignoradas; `1005` testes aprovados e `2` ignorados.
- A suíte Linux incluiu o teste completo de gravação com FFmpeg real; a imagem final contém FFmpeg e FFprobe.
- A imagem executa como UID/GID `1001:1001` e não contém componentes-fonte nem configuração Vitest.

## Implantação

- Publicação app-only iniciada em `2026-08-22T15:51:22Z`.
- Somente `xp-whatsapp-app` foi recriado.
- O PostgreSQL preservou ID `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585` e início `2026-08-20T14:59:13.244166666Z`.
- O snapshot determinístico de todos os containers exceto o app permaneceu idêntico antes e depois.
- A migração `202608220001_rich_inbound_messages` foi aplicada uma vez; estado final Prisma: `10` concluídas, `0` pendentes, `0` revertidas.
- Container final: saudável, zero reinícios e revisão OCI igual ao commit implantado.
- Health local, health público e login público: HTTP 200.
- Requisição Meta com assinatura inválida: HTTP 401.
- Acesso anônimo a `/conversas`: HTTP 307 para autenticação.
- Três amostras consecutivas: `200|200|healthy|0`.
- Marcadores de erro nos logs posteriores à implantação: `0`.

## Funcionalidades entregues

- Figurinhas WEBP estáticas e animadas com recuperação de mídia autenticada.
- Localização com nome, endereço, coordenadas e link seguro para o Google Maps.
- Contatos compartilhados sem cadastro ou importação automática.
- Respostas de botões e listas sem exposição do identificador técnico.
- Cartões seguros para pedidos, eventos de sistema e tipos desconhecidos.
- Prévias úteis na lista de conversas.
- Mensagens enviadas pelo aplicativo WhatsApp Business continuam sincronizadas por `smb_message_echoes`.

## Limpeza e rollback

Os arquivos de transporte foram removidos da KVM depois do carregamento. O diretório temporário local `C:\Users\developer\AppData\Local\Temp\xp-rich-deploy-ea029363b854464c83f9e7b173b65d0c` contém apenas os archives de fonte e imagem; a política do runtime bloqueou sua exclusão automática.

Rollback imediato é app-only para a release `e8b9cff8f17aba03b7d877d28a0a965d75d07ddf`. A migração nova é aditiva e permanece compatível com a aplicação anterior; banco, mídia, gateway, redes e outros serviços não devem ser recriados.
