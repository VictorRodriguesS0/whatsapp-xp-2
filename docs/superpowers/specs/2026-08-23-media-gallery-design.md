# Visualizador de mídias da conversa — desenho aprovado

## Objetivo

Adicionar uma experiência próxima ao WhatsApp oficial para visualizar imagens, vídeos e arquivos PDF sem sair da conversa, preservando a segurança do endpoint autenticado de mídia e todas as funcionalidades já integradas em produção.

## Escopo funcional

- Imagens, vídeos e PDFs disponíveis na conversa formam uma galeria única em ordem cronológica.
- Clicar na miniatura abre um overlay em tela cheia, sem navegar para outra página.
- O cabeçalho mostra nome do arquivo, posição atual (`x de y`) e ações de baixar, abrir em nova aba e fechar.
- Setas na tela, teclas `←`/`→` e gesto horizontal no celular navegam entre itens.
- `Esc` fecha o visualizador. No celular, o botão voltar fecha primeiro o visualizador e mantém a conversa aberta.
- Ao fechar, o foco retorna ao elemento que abriu a mídia.
- Áudios, figurinhas e documentos que não sejam PDF mantêm o comportamento atual.

## Comportamento por mídia

### Imagens

- A imagem é ajustada inicialmente à área disponível.
- Controles permitem ampliar, reduzir e redefinir o zoom.
- Roda do mouse, duplo clique e gesto de pinça alteram o zoom quando suportados.
- Quando ampliada, a imagem pode ser arrastada.

### Vídeos

- O reprodutor usa controles nativos do navegador.
- O vídeo é pausado ao trocar de item ou fechar o visualizador.
- O endpoint suporta requisições HTTP Range de um único intervalo, permitindo busca eficiente no vídeo.

### PDFs

- PDFs validados são exibidos completos com o visualizador nativo do navegador, incluindo navegação de páginas, zoom, impressão e download quando o navegador oferece esses recursos.
- Se o navegador não suportar visualização embutida, o usuário recebe ações claras para abrir em nova aba ou baixar.
- Outros documentos continuam sendo baixados, sem tentativa de renderização inline.

## Arquitetura de interface

- `ConversationView` mantém o item ativo e deriva a galeria das mensagens carregadas.
- `MessageMedia` continua responsável pela miniatura e pela recuperação automática/manual de mídias; recebe um callback opcional para abrir itens elegíveis.
- Um novo `MediaViewerDialog` concentra navegação, atalhos, gestos, zoom, limpeza de recursos e acessibilidade.
- Apenas o item ativo carrega a mídia completa; ao mudar de item, o componente anterior é desmontado e seus recursos são liberados.
- Os controles usam elementos interativos reais, evitando que o clique seja interpretado como resposta à mensagem.

## Contrato de dados e segurança

- O DTO de mensagem expõe apenas o MIME type validado necessário para distinguir PDFs de outros documentos. Chaves de armazenamento, hashes, caminhos locais, identificadores do provedor e detalhes de falha continuam privados.
- A mídia continua acessível exclusivamente por `/api/media/:id`, com sessão autenticada e autorização baseada no usuário.
- A resposta usa `Content-Disposition: inline` somente para tipos seguros de visualização; PDFs exigem MIME validado `application/pdf`. Downloads explícitos continuam usando `attachment`.
- O endpoint aceita no máximo um intervalo de bytes válido e retorna `206 Partial Content`, `Content-Range`, `Accept-Ranges` e comprimento correto. Intervalos múltiplos ou impossíveis retornam `416` sem expor dados.
- Permanecem `X-Content-Type-Options: nosniff` e cache privado sem armazenamento.

## Compatibilidade e estados de erro

- Mídia pendente ou que falhou mantém os estados atuais de carregamento, nova tentativa e erro.
- Falha no carregamento dentro do visualizador não fecha a galeria; oferece nova tentativa, abrir em nova aba ou baixar conforme aplicável.
- O layout respeita áreas seguras no celular e mantém controles acionáveis por toque.

## Dados e migrações

Não há alteração no banco de dados nem migração. O MIME type já existe no objeto de mídia e será incluído de forma sanitizada no DTO.

## Verificação

- Testes de contrato garantem que somente o MIME seguro foi acrescentado ao DTO.
- Testes da rota cobrem resposta completa, download, preview de PDF, intervalos válidos, sufixados, abertos, múltiplos e inválidos.
- Testes de componentes cobrem abertura, fechamento, navegação, foco, atalhos, elegibilidade, PDF, vídeo e zoom de imagem.
- A verificação no navegador cobre desktop e viewport móvel, incluindo voltar do navegador.
- Antes do deploy, todas as worktrees e branches paralelas serão auditadas novamente; somente trabalhos concluídos, testados e com ancestralidade conhecida serão integrados.
- O deploy será imutável e somente o container da aplicação será recriado, preservando banco, proxy e demais sistemas da KVM.

## Fora do escopo

- Edição ou anotação de mídias.
- Download em lote.
- Galeria de figurinhas ou áudios.
- Renderizador PDF próprio ou dependência de PDF.js.
- Alterações em retenção de arquivos ou permissões da Meta.
