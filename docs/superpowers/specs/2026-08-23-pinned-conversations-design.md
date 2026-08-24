# Conversas fixadas compartilhadas

## Objetivo

Permitir que qualquer usuário fixe ou desfixe conversas na caixa de atendimento. O estado é único para a empresa e deve aparecer em tempo real para todos os usuários autenticados.

## Comportamento

- Não há limite de conversas fixadas.
- Conversas fixadas aparecem antes das demais na listagem principal.
- Entre as conversas fixadas, a mais recentemente fixada aparece primeiro.
- Entre as conversas não fixadas, permanece a ordenação atual pela mensagem mais recente.
- Fixar novamente uma conversa que já está fixada é uma operação idempotente e não altera sua posição.
- Desfixar uma conversa faz com que ela volte imediatamente à posição determinada pela última mensagem.
- O estado fixado não depende do atendente: todos os usuários veem e modificam a mesma organização.

## Interface

- Cada item da lista terá uma ação com os rótulos acessíveis “Fixar conversa” ou “Desfixar conversa”.
- Em desktop, a ação pode ficar visualmente discreta e ganhar destaque no foco ou ao passar o ponteiro.
- Em dispositivos móveis, a ação continua disponível sem depender de `hover`.
- Uma conversa fixada exibe um ícone de alfinete persistente.
- A ação usa atualização otimista para reposicionar a conversa imediatamente.
- Enquanto a alteração estiver em andamento, novas ações conflitantes para a mesma conversa ficam bloqueadas.
- Se a API rejeitar ou não confirmar a alteração, a interface restaura o estado anterior e mostra um erro conciso.

## Persistência e ordenação

- A tabela de conversas receberá `pinned_at`, anulável e com fuso horário.
- `pinned_at = null` significa conversa não fixada.
- Fixar atribui o horário do servidor somente quando a conversa ainda não está fixada.
- Desfixar atribui `null`.
- A consulta paginada será ordenada por grupo fixado, `pinned_at` decrescente e, para as demais conversas, `last_message_at` decrescente, mantendo um desempate estável pelo identificador.
- A paginação deve preservar a separação e a ordem mesmo quando houver mais conversas fixadas do que o tamanho de uma página.

## API e autorização

- Uma rota autenticada da conversa aceitará a intenção explícita de fixar ou desfixar.
- Atendentes e administradores ativos poderão executar ambas as ações, seguindo o modelo atual da caixa compartilhada.
- Conversas inexistentes retornam `404`; payload inválido retorna `400`; falhas inesperadas não expõem detalhes internos.
- A resposta devolve o estado persistido e a revisão necessária para reconciliação do cliente.

## Sincronização em tempo real

- Após persistir a alteração, o servidor publicará um evento de conversa atualizada com o identificador da conversa.
- Todos os clientes conectados atualizarão a primeira página da lista usando o mecanismo de reconciliação já existente.
- O cliente que iniciou a ação também reconcilia sua atualização otimista com a resposta da API e com o evento, sem duplicação ou oscilação.

## Concorrência

- Fixar e desfixar são idempotentes em relação ao estado solicitado.
- Se dois usuários enviarem ações concorrentes, prevalece a última operação persistida no servidor.
- O cliente sempre reconcilia com o valor confirmado pelo servidor ou pela próxima atualização em tempo real.

## Migração e produção

- A migração adiciona a coluna anulável sem alterar conversas existentes; todas começam desfixadas.
- Será criado o índice necessário para a nova ordenação sem remover os índices atuais.
- O deploy seguirá o procedimento existente de backup, migração, troca do contêiner da aplicação e verificação de saúde.
- Antes do deploy, mudanças paralelas serão identificadas e integradas sem sobrescrever trabalho externo.

## Testes e critérios de aceite

- Serviço: fixa, desfixa, mantém fixação idempotente e trata conversa ausente.
- Banco/consulta: fixadas vêm primeiro; ordem por fixação e por última mensagem é estável; a paginação funciona quando as fixadas atravessam páginas.
- API: autenticação, validação, respostas e erros públicos.
- Interface: rótulos, ícone, estado pendente, atualização otimista e rollback.
- Tempo real: uma alteração provoca atualização da lista em outra sessão.
- Regressão: leitura compartilhada, mensagens recebidas, busca, seleção e carregamento incremental continuam funcionando.
- Produção: migração aplicada, rota autenticada validada e aplicação saudável após a troca.

