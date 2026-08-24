# Reconexão controlada e carga inicial da agenda — Design

**Data:** 2026-08-23

**Status:** aprovado em conversa; aguardando revisão do documento

**Escopo:** refazer o onboarding oficial de coexistência do número da XP Eletrônicos e solicitar somente a carga inicial da agenda do WhatsApp Business App, preservando integralmente o histórico já armazenado pelo atendimento

## Objetivo

Recuperar a carga inicial de contatos que não ocorreu na ativação anterior. O backend, a migration e a assinatura futura de `smb_app_state_sync` já estão em produção, mas a chamada única anterior de `POST /{PHONE_NUMBER_ID}/smb_app_data` retornou Meta `131000` e produziu zero contatos sincronizados.

A loja autorizou uma desconexão temporária. A operação será feita agora porque a loja não abrirá no dia seguinte. Esta entrega não implementa edição de mensagens; esse comportamento terá design e implementação separados após a agenda estar sincronizada.

Referência oficial: [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

## Garantia de preservação

O PostgreSQL, os volumes de mídia e o histórico do atendimento não participam do re-onboarding e não serão apagados, restaurados ou recriados. Permanecem preservados:

- conversas e mensagens existentes;
- contatos, nomes manuais, etiquetas e tipos;
- responsáveis, leituras, fixações e lembretes;
- mídias, usuários e configurações internas.

Antes de qualquer mudança na Meta, será criado e validado um backup novo de banco e mídia. A sincronização de agenda apenas cria ou atualiza a fonte `WhatsAppAppContact`; ela não cria conversas para contatos que nunca falaram com a loja e não sobrescreve `preferredName`.

## Isolamento dos trabalhos paralelos

A operação usa o branch isolado `codex/complete-phone-sync` somente para documentação e evidências. Nenhum commit dos worktrees de janela de 24 horas, alertas Meta ou galeria será integrado, alterado ou implantado.

Imediatamente antes de cada mutação externa, a auditoria registra todos os worktrees, seus HEADs e estados. Também registra a revisão e imagem realmente ativas na KVM. Se outro trabalho estiver implantando, alterando credenciais Meta ou recriando `xp-whatsapp-app`, a operação para até o estado ficar estável.

Nenhuma mudança de código ou migration é necessária para receber a agenda. Se o re-onboarding conservar os identificadores e a credencial atual, nenhum container será recriado. Se algum identificador ou autorização mudar, somente a configuração secreta canônica será atualizada e somente `xp-whatsapp-app`, usando a mesma imagem ativa, poderá ser recriado depois de novo snapshot e verificação.

## Pré-verificação

Antes da desconexão:

1. confirmar health local e público, imagem/revisão, reinícios e identidade do banco;
2. registrar snapshot determinístico dos containers não pertencentes à aplicação;
3. criar e validar backup de banco e mídia em `/srv/backups/example-app`;
4. ler, sem alterar, o WABA, o número, o status de coexistência, o callback e o conjunto de campos assinados;
5. exigir `messages`, `smb_message_echoes` e `smb_app_state_sync` exatamente uma vez;
6. registrar somente hashes, contagens e identificadores operacionais necessários, nunca tokens, nomes, telefones ou payloads.

Qualquer inconsistência, health inválido ou trabalho paralelo em implantação bloqueia o início.

## Re-onboarding

O usuário concluirá no navegador autenticado o fluxo oficial de Embedded Signup para reconectar o mesmo número do WhatsApp Business App. A operação não cria deliberadamente outro número e não remove a conta comercial existente sem confirmação explícita na própria interface da Meta.

Após o fluxo:

- confirmar que o número continua em coexistência, com `is_on_biz_app=true` e Cloud API ativa;
- comparar WABA ID e Phone Number ID com os valores anteriores;
- reatribuir ao usuário de sistema somente os ativos e permissões necessários, se a Meta os tiver removido;
- gerar ou trocar credencial somente se a atual deixar de autorizar as leituras e webhooks exigidos;
- preservar o callback e todos os campos anteriores, acrescentando apenas algum campo obrigatório que tenha sido removido pelo onboarding.

Se a Meta apresentar uma escolha de compartilhamento, será autorizado **contatos**, mas não será solicitada a importação do histórico antigo de mensagens nesta operação.

## Solicitação da agenda

Assim que o onboarding for confirmado, e dentro da janela oficial disponível:

1. fazer readback independente da assinatura e do número;
2. chamar uma única vez `POST /{PHONE_NUMBER_ID}/smb_app_data` com `messaging_product=whatsapp` e `sync_type=smb_app_state_sync`;
3. registrar o request ID ou o código de erro seguro, sem corpo bruto;
4. não repetir automaticamente a chamada;
5. aguardar webhooks assinados e monitorar agregados processados, isolados, duplicados e falhos;
6. confirmar que contatos importados não criaram conversas artificiais;
7. validar com o usuário alguns nomes já existentes na agenda e uma inclusão/edição/removação controlada.

Um erro novamente classificado como não repetível encerra a tentativa e preserva o número conectado. A investigação continua por suporte Meta usando o request ID, sem novo offboarding automático.

## Concorrência e identidade

Os eventos de agenda continuam usando telefone canônico e ordenação autoritativa `(sourceTimestamp, actionRank, sourceVersionKey)`. Reentregas são idempotentes; remoções criam tombstones; nomes manuais têm precedência sobre nomes do celular.

Se o onboarding mudar WABA ID, Phone Number ID ou a identidade vinculada ao token, a aplicação só volta a receber tráfego depois que todas as referências canônicas forem reconciliadas e lidas novamente. Não se cria um segundo banco, não se duplica uma conversa e não se migra histórico por telefone sem as regras de identidade já existentes.

## Falhas e recuperação

Antes da reconexão, uma falha não exige rollback porque nenhuma mutação ocorreu. Depois da desconexão:

- priorizar restaurar a conectividade do mesmo número;
- não apagar contatos ou mensagens para tentar repetir a sincronização;
- não restaurar o banco por causa de erro Meta;
- se uma configuração nova impedir o app de iniciar, restaurar a cópia anterior da configuração e recriar somente a mesma imagem de `xp-whatsapp-app`;
- não reiniciar PostgreSQL, Caddy, Docker, DNS, redes, volumes ou sistemas não relacionados;
- preservar dados aditivos já recebidos mesmo em rollback da conexão.

Se a reconexão não puder ser concluída na mesma janela operacional, a produção permanecerá documentada como temporariamente desconectada e o usuário receberá o ponto exato do fluxo que exige ação, sem alegação de sucesso parcial.

## Critérios de aceitação

A operação é aceita somente quando:

- o mesmo número está conectado à coexistência e envia/recebe mensagens novas pelo celular e pelo sistema;
- health público/local está `200`, aplicação saudável e reinícios em zero;
- a assinatura contém `messages`, `smb_message_echoes` e `smb_app_state_sync` uma única vez;
- a carga inicial retorna sucesso e ao menos um lote válido é processado, ou a Meta confirma formalmente agenda vazia;
- nomes da agenda respeitam `preferredName > whatsappAppName > profileName > telefone`;
- nenhum contato sem conversa passa a aparecer na fila;
- mensagens, conversas, etiquetas, tipos, responsáveis, leituras e mídias anteriores permanecem acessíveis;
- snapshot dos containers não relacionados permanece idêntico;
- request IDs, backup, revisão ativa e evidências sem PII ficam documentados.

## Fora do escopo

- Importar histórico antigo de mensagens do celular.
- Alterar mensagens já armazenadas.
- Implementar o conteúdo de eventos `edit`.
- Enviar ou editar contatos do sistema para o celular.
- Integrar ou implantar commits dos trabalhos paralelos.
- Repetir automaticamente a chamada única de sincronização.
