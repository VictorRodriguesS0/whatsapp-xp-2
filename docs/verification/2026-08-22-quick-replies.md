# Verificação — respostas rápidas compartilhadas

Data: 2026-08-22  
Revisão publicada: `71ed9c80afd73f44dfaf9b6125097d3054e5eb4d`  
Imagem: `xp-whatsapp:71ed9c8` (`sha256:aa8e5a905aa168fe077e02f3d60f933bdbf1d126c57765fd38a4162b4c0ceba5`)

## Escopo aceito

- Catálogo compartilhado pela empresa, acessível a administradores e atendentes.
- Cadastro, edição, ativação e desativação de atalhos.
- Abertura do seletor ao digitar `/` no compositor.
- Filtro por atalho ou conteúdo e seleção por clique, `Enter`, `ArrowUp` e `ArrowDown`.
- Inserção do texto sem envio automático; o atendente mantém a revisão final da mensagem.

## Evidências automatizadas

- Suite completa no ambiente Linux da imagem: 1.023 testes aprovados, 2 ignorados, 0 falhas.
- Lint, checagem de tipos, validação Prisma e build de produção aprovados.
- Auditoria das dependências de produção: 0 vulnerabilidades.
- Validações de implantação e de finais de linha POSIX aprovadas.
- Migração `202608220002_quick_replies` aplicada; 11 migrações aplicadas e nenhuma pendente ou falha.

## Evidências em produção

- Backup validado antes da troca: `/srv/backups/example-app/example-backup`.
- `https://whatsapp.xpeletronicos.com/api/health`: HTTP 200.
- `http://127.0.0.1:3100/api/health` na KVM: HTTP 200.
- Três amostras consecutivas: contêiner `running`, `healthy`, `restarts=0` e mesmo `StartedAt`.
- Busca nos logs dos dez minutos finais por `error`, `exception`, `fatal` e `panic`: sem ocorrências.
- Acesso anônimo a `/conversas` redireciona para `/login`; a tela pública de login carregou com o título `XP Atendimento`.
- O teste visual autenticado não foi executado sem uma sessão ou credencial disponível; o fluxo funcional autenticado está coberto pela suíte automatizada.

## Segurança operacional

- O primeiro ensaio de implantação detectou a porta local incorreta no pós-check e restaurou automaticamente a versão anterior, ainda saudável.
- A causa foi corrigida no procedimento, a nova implantação concluiu com sucesso e os demais serviços da KVM permaneceram inalterados.
- Nenhuma mensagem real foi enviada durante a validação.
