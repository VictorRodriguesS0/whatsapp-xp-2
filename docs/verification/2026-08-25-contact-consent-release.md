# Consentimento de contato por WhatsApp — verificação de produção

Data da implantação: 25 de agosto de 2026

## Resultado

A central agora permite registrar e revogar a autorização explícita de um
contato para receber mensagens da loja pelo WhatsApp. Esta release registra
somente o consentimento; ela não adiciona envio proativo nem contorna a janela
de atendimento ou os templates exigidos pela Meta.

O controle fica nos dados do contato e aceita exatamente as origens
`WHATSAPP`, `LOJA_FISICA`, `TELEFONE` e `OUTRO`. A origem `OUTRO` exige uma
observação de 3 a 240 caracteres. Data, hora e atendente são definidos no
servidor. A marcação “não contatar” prevalece, revoga atomicamente uma
autorização ativa e impede novo registro. Remover a restrição não restaura o
consentimento anterior.

## Revisão e artefato

- Revisão publicada: `5698cc9c305fbda056545f6fbf2161c4e1b2521b`.
- Imagem imutável:
  `xp-whatsapp:5698cc9c305fbda056545f6fbf2161c4e1b2521b`.
- Image ID: `sha256:a0bbaadd9f53312499cc926ca2a8801e9377172a7184caf42d5f90d332b53518`.
- SHA-256 do transporte da imagem:
  `2311f14baa88a697113f606f9f8c2f19d935c1308d2e6956546662d27afe0e66`.
- SHA-256 do Git archive:
  `da8a1933d185d5b73eccb88ed6d6f0641d8f5c44f1446c85b6054ac97f679fe0`.
- Revisão anterior e rollback imediato:
  `3d2a350cfe7814da22189dd8dae5410076162d9d`.
- Image ID anterior:
  `sha256:9abb398373d2fc7c11a969a19506a64b1cfc4cc6602b34364ada9dbe6261d649`.

A revisão anterior é ancestral direta da candidata. O preflight não encontrou
trabalho paralelo do XP WhatsApp fora da candidata. Outros sistemas da KVM
estavam ativos, mas não foram recriados ou reconfigurados.

## Gates locais e do artefato

- Prisma generate/validate: aprovados.
- Banco vazio: 21 migrations aplicadas; a segunda execução informou zero
  migration pendente.
- Contrato da migration de consentimento: 2 testes aprovados.
- Suíte completa: 202 arquivos aprovados e 2 ignorados; 1.765 testes aprovados
  e 3 ignorados pelas flags existentes.
- ESLint, TypeScript, `git diff --check` e build Next.js: aprovados.
- Testes de mutação do deploy e verificadores Compose/KVM: aprovados com
  PowerShell 7.
- Auditoria das dependências de produção: zero vulnerabilidades.
- Imagem exata Linux/amd64: usuário não privilegiado `1001:1001`, label OCI
  correto, FFmpeg e Poppler presentes, migration incluída e nenhum `.git`,
  `.env` ou diretório de documentação no runtime.
- Smoke da imagem: migration sem pendência, health HTTP 200, container saudável
  e zero reinícios.

Uma falha legítima da primeira suíte completa revelou que o contrato global de
timestamps ainda esperava 34 colunas. O teste foi atualizado para exigir 35 e
validar explicitamente `contacts.messaging_consent_granted_at` como
`timestamp with time zone`; a suíte integral foi então executada novamente e
aprovada.

## Aceite no navegador

Na mesma imagem imutável publicada, o aceite autenticado validou desktop e
viewport 390×844:

- seleção das quatro origens;
- cancelamento sem gravação;
- nota obrigatória para `OUTRO`;
- confirmação habilitada somente com entrada válida;
- exibição da data/hora e do atendente retornados pelo servidor;
- confirmação explícita de revogação;
- botão de autorização desabilitado durante “não contatar”;
- remoção da restrição sem restaurar o consentimento;
- diálogo móvel inteiramente dentro do viewport;
- `Escape` fechando o diálogo e restaurando foco no botão de registro;
- ausência de botão de envio proativo nesta release;
- zero erro no console.

## Backup, migration e rollout

- Backup validado:
  `/srv/backups/example-app/example-backup`.
- SHA-256 do banco:
  `836eea7f9812dc7da3d102dbd81fffc2eb704be6d982b9c956a1986ce98bd64f`.
- SHA-256 da mídia:
  `728dd37ad249ebfda3875c2cc4ca31031495bc846e1c4d4534a565e350f4fae3`.
- Cópia do ambiente anterior:
  `/opt/apps/example-app/.env.production.pre-5698cc9c305fbda056545f6fbf2161c4e1b2521b`.
- App novo:
  `9ad378ccdea31de71a7bdb0fb5298a920ee9d0b6f4aa4012f27ac18ae74fecdb`.
- Banco preservado:
  `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`.

A migration `202608250001_contact_messaging_consent` foi aplicada uma vez e
criou quatro colunas atuais, a tabela imutável de eventos, chaves, índices e
restrições de consistência. O entrypoint da nova imagem confirmou depois que
não havia migration pendente.

Somente `xp-whatsapp-app` foi recriado, sob lock exclusivo e com rollback
automático preparado. PostgreSQL manteve ID, imagem, instante de início, health
e zero reinícios. O snapshot de nomes, IDs e imagens de todos os containers
não-app permaneceu idêntico antes, logo depois e ao final, com SHA-256
`6d47c22e61bcee20517fd1f40cd74bd2ff3703c4b0fab8e8b48d860db848d6d8`.

`current`, `XP_WHATSAPP_IMAGE`, a imagem em execução e o label OCI ficaram
alinhados à revisão publicada.

## Aceite em produção

Um contato de teste previamente indicado pelo usuário foi usado sem envio de
mensagem. Duas sessões administrativas temporárias e independentes validaram o
read model consumido pela interface:

1. a primeira sessão registrou origem `WHATSAPP` e recebeu HTTP 200;
2. a segunda sessão leu imediatamente estado ativo, origem, data e atendente;
3. o banco confirmou uma linha atual ativa e um evento `GRANTED` com ator e
   timestamp do servidor;
4. a segunda sessão revogou e recebeu HTTP 200;
5. a primeira sessão leu imediatamente o estado inativo;
6. o banco confirmou a sequência exata `GRANTED,REVOKED`.

As sessões curtas e seus arquivos de resposta foram removidos. O estado final
aprovado ficou seguro: zero consentimentos ativos, dois eventos apenas para o
contato controlado e zero evento para contatos legados. A base passou de 175
para 176 contatos durante a janela de rollout, fora das operações desta feature;
mesmo assim, permaneceu com zero backfill de consentimento.

Nenhuma mensagem real foi enviada durante o aceite. Também não houve webhook
real no intervalo curto de soak; por isso não foi fabricada prova de eco de
celular. O endpoint de health permaneceu 200, a rota protegida sem sessão
permaneceu 401 e uma verificação Meta deliberadamente inválida permaneceu 403.
Esta release não mudou a ingestão de webhooks nem o envio/eco oficial.

## Estabilidade

Três amostras separadas por 20 segundos confirmaram:

- app e banco `running/healthy`;
- zero reinícios;
- banco com o mesmo container ID;
- health público HTTP 200.

Os logs desde o rollout tiveram zero marcador de erro/fatal, exceção não
tratada ou recusa de conexão. Permaneceram apenas a rejeição esperada do token
de webhook inválido usado no gate e um aviso de depreciação do driver `pg`, já
observado na suíte de integração e sem falha funcional.

## Rollback

O rollback é app-only. Restaure o arquivo de ambiente preservado, aponte
`current` para `3d2a350cfe7814da22189dd8dae5410076162d9d` e recrie somente
`app` com `--no-deps --force-recreate --wait`. A migration é aditiva e pode
permanecer aplicada; a imagem anterior ignora as novas colunas e tabela. Não
restaure banco/mídia salvo em caso de perda de dados e não recrie PostgreSQL,
redes, volumes, gateway ou outros serviços da KVM.
