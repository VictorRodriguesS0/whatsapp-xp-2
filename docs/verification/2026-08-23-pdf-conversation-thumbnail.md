# Miniaturas de PDF na conversa — verificação de produção

Data da publicação: 2026-08-24

## Release

- Revisão publicada: `41b8ac6ada5babfc6e280bb131d792baad6bf984`.
- Imagem imutável: `xp-whatsapp:41b8ac6ada5babfc6e280bb131d792baad6bf984`.
- ID da imagem: `sha256:6411bf1c0283544eb085c7afa3c5f4d74d4326d2fd4c45eaa346993c45e7ce2b`.
- ID do container: `052e90167fcaf66ce753388d486dce20cb1c8179fa09f139d344cd5b094e8424`.
- Release ativa: `/opt/apps/example-app/releases/41b8ac6ada5babfc6e280bb131d792baad6bf984`.
- Backup validado: `/srv/backups/example-app/example-backup`.
- Ambiente anterior preservado: `/opt/apps/example-app/.env.production.backup`.

## Funcionalidade

- PDFs recebidos e enviados mostram a primeira página dentro do balão da conversa.
- A prévia é um botão acessível que abre o visualizador completo já existente.
- O rodapé compacto preserva ícone, nome do arquivo e indicação `PDF`, próximo ao comportamento do WhatsApp móvel.
- Em falha de geração ou em mensagens otimistas sem mídia persistida, a interface mantém o botão compacto anterior.
- Ao fechar o visualizador com `Esc`, o foco retorna ao documento que o abriu.

## Segurança e limites

- A rota de miniatura exige sessão e repete a autorização da mídia para cada usuário antes de servir ou compartilhar trabalho em andamento.
- A resposta usa `image/png`, cache privado sem armazenamento e proteção contra interpretação de conteúdo.
- O arquivo original e a miniatura permanecem fora do diretório público.
- A geração usa somente a primeira página, largura máxima de 640 pixels, timeout de 10 segundos, concorrência global de uma conversão e limite de 4 MiB.
- Nome, hash, caminho, inode e assinatura PNG são validados; a gravação final é atômica.
- O cache é identificado pela identidade imutável da mídia e não expõe hash ou caminho ao navegador.

## Gates antes da publicação

- ESLint, TypeScript e build de produção Next.js: aprovados.
- Testes da superfície de interface relacionada: 68/68 aprovados.
- Testes focados da geração, autorização, rota e componente: aprovados; a repetição final passou 22/22.
- Suíte completa no runtime Linux da imagem, com banco PostgreSQL descartável e provedor demo: 146 arquivos e 1.330 testes aprovados.
- A primeira execução completa herdou `WHATSAPP_PROVIDER=meta` da produção e deixou três testes antigos em estado pendente. A repetição isolada com o provedor de teste documentado passou integralmente; não houve alteração de produto por esse motivo.
- O banco descartável `xp_pdf_thumbnail_41b8ac6_test` foi removido e sua ausência confirmada.
- O runtime contém `pdftoppm 22.12.0` e executa como UID/GID `1001:1001`.

## Auditoria de trabalhos paralelos

A auditoria foi repetida imediatamente antes do deploy. A produção ainda executava a revisão `2f8f865aa9a70047fbb5223dbef146bc3d41e0cf`, que é ancestral da candidata. As demais worktrees continham documentação ou mudanças incompletas e separadas de janela de atendimento, sincronização de telefone e saúde da Meta. Nenhuma delas estava publicada nem foi incorporada parcialmente. A candidata estava limpa e preservou todas as funcionalidades que já estavam em produção.

## Deploy e pós-deploy

- Somente `xp-whatsapp-app` foi recriado; banco e gateway conservaram os IDs anteriores.
- As 17 migrations estavam concluídas e nenhuma migration estava pendente.
- O container ficou `healthy`, com zero reinícios, na imagem imutável esperada.
- `GET https://whatsapp.xpeletronicos.com/api/health` retornou `{"status":"ok"}`.
- Uma tentativa sem autenticação na rota de miniatura retornou HTTP 401.
- O cache privado continha três miniaturas após os testes reais.
- Os logs pós-início continham apenas a verificação de migrations e o início normal do Next.js, sem erro da funcionalidade.

## Verificação autenticada no navegador

- Um PDF enviado carregou a miniatura completa em 640 × 906 pixels e abriu no visualizador de documentos.
- Dois PDFs recebidos carregaram miniaturas completas em 640 × 906 pixels.
- O visualizador de PDF recebido abriu normalmente; `Esc` fechou o diálogo e devolveu o foco ao botão do documento.
- A interface exibiu o estado de carregamento enquanto a primeira página era gerada e o removeu ao concluir.
- Não houve aviso ou erro no console durante o fluxo testado.
