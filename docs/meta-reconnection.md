# Reconexão oficial do WhatsApp Business

A reconexão fica em **Configurações → Saúde da Meta** (`/configuracoes/meta`), acessível a administradores. Usa o Embedded Signup v4 da Meta para coexistência com o WhatsApp Business do celular principal.

## Comportamento

A conexão é independente da qualidade do número: `GREEN` não significa conectado. O sistema só confirma `CONNECTED` quando uma consulta recente verifica simultaneamente:

- o número configurado com `status=CONNECTED`, `platform_type=CLOUD_API` e `is_on_biz_app=true`;
- o aplicativo configurado em `WABA/subscribed_apps`;
- uma assinatura ativa de `whatsapp_business_account` no aplicativo com `messages`, `account_update`, `smb_message_echoes` e `smb_app_state_sync`.

`ACCOUNT_OFFBOARDED` e `PARTNER_REMOVED` suspendem os novos envios. Assinaturas ausentes também impedem a confirmação e suspendem os envios. `ACCOUNT_RECONNECTED` sozinho não libera a central. Erros ou respostas incompletas preservam uma desconexão já confirmada. Consultas usam o horário de início; eventos antigos são ignorados, e desconexão tem prioridade em conflitos no mesmo segundo.

O estado inicial `UNKNOWN` é exibido como “A confirmar” e não bloqueia uma instalação que ainda não recebeu evidência de desconexão. A migração não transforma alertas históricos sem data confiável em evidência atual. Execute uma atualização do diagnóstico após implantar.

O bloqueio cobre mensagens, mídia, templates, catálogo, reações e confirmações de leitura. Consultas e downloads continuam disponíveis. Repetições de uma operação já concluída mantêm a resposta idempotente. Mensagens pendentes não são reenviadas automaticamente após reconectar; confirmações de leitura interrompidas podem voltar à rotina de repetição existente.

## Requisitos externos

No mesmo aplicativo Meta já utilizado pela central:

1. Confirmar elegibilidade para onboarding de coexistência como Tech Provider/Solution Partner, permissões e verificações exigidas pela Meta. Ter acesso ao app e um token válido não comprova essa elegibilidade.
2. Criar uma configuração de **Facebook Login for Business / WhatsApp Embedded Signup**, conforme a documentação oficial, para o fluxo de coexistência. Guardar o `config_id`.
3. Autorizar o domínio HTTPS da central, o JavaScript SDK e as URLs de redirecionamento exatas exigidas pela configuração. Usar a origem de `NEXT_PUBLIC_APP_URL`, sem curingas amplos.
4. Confirmar que o administrador e a credencial permanente têm acesso ao mesmo negócio, WABA e número. Conferir `whatsapp_business_management` e `whatsapp_business_messaging`.
5. Manter o webhook HTTPS e os campos existentes. A implementação pode reassinar apenas o aplicativo configurado à WABA; não substitui os campos do webhook nem cria novos ativos.
6. Ter o WhatsApp Business principal atualizado e disponível para concluir a etapa oficial de QR code ou código de acesso.

O **novo onboarding desvincula os aparelhos adicionais**. A interface avisa antes de abrir o fluxo. Depois, vincule os aparelhos novamente pelo WhatsApp principal. Essa característica do onboarding não explica, por si só, desconexões diárias fora do fluxo.

## Variáveis de ambiente

Além das credenciais existentes, configurar somente no ambiente do servidor:

| Variável | Valor |
| --- | --- |
| `META_EMBEDDED_SIGNUP_ENABLED` | `false` por padrão; `true` após validar os requisitos |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | ID numérico da configuração do mesmo app |
| `META_BUSINESS_ID` | ID numérico do negócio proprietário da WABA existente |
| `META_EMBEDDED_SIGNUP_GRAPH_VERSION` | `v26.0`, versão do JavaScript SDK |

Preservar `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID` e `WHATSAPP_PHONE_NUMBER_ID`. `META_GRAPH_API_VERSION` continua controlando as chamadas Graph e o envio de mensagens; não é alterada por esta funcionalidade. A versão de session logging é `3`, enquanto o fluxo de Embedded Signup usa `extras.version=v4`.

Os dois arquivos Compose repassam as novas variáveis em runtime. Não colocar segredos em variáveis `NEXT_PUBLIC_*`. Só os IDs públicos necessários ao SDK chegam ao navegador.

## Fluxo e recuperação

1. Atualizar o diagnóstico antes de iniciar outro vínculo. Uma confirmação recente impede um novo onboarding desnecessário.
2. Clicar em **Reconectar WhatsApp** para preparar o SDK e a tentativa. Ler o aviso sobre aparelhos adicionais.
3. Clicar em **Continuar na Meta**. O segundo clique abre o popup com um gesto direto do usuário. Selecionar os ativos da loja e concluir a etapa no celular principal.
4. O callback OAuth é enviado imediatamente ao servidor: o código da Meta expira rapidamente e não deve aguardar o evento de conclusão. Código e token temporário não são persistidos nem registrados em logs.
5. O servidor valida app, permissões, negócio, WABA e número. A credencial permanente existente permanece em uso. A confirmação por Graph e por assinaturas ocorre separadamente do popup.
6. A tela consulta a confirmação a cada cinco segundos por até dois minutos; depois oferece consulta manual. A tentativa expira em quinze minutos.

A tentativa pertence ao administrador e à sessão que a iniciou. Há somente uma tentativa ativa por número, limite de seis inícios em quinze minutos e proteção contra código repetido. Recarregar a página recupera o estado, mas não o código nem o nonce; consulte ou encerre a tentativa antes de iniciar outra. Metadados de tentativas antigas são removidos ao abrir novas tentativas após o período de retenção de 24 horas contado da expiração.

**Encerrar tentativa** encerra o acompanhamento local. Não desfaz uma etapa já concluída na Meta. Atualize o diagnóstico antes de reiniciar. Falhas de rede não repetem a troca OAuth automaticamente.

| Situação | Ação |
| --- | --- |
| Botão indisponível | Conferir flag, IDs, provedor Meta e HTTPS |
| Popup bloqueado | Permitir popup no domínio, encerrar tentativa e preparar outra |
| Ativo divergente | Selecionar o mesmo negócio, WABA e número; não editar IDs para contornar a validação |
| Autorização inválida | Conferir app, escopos, acesso e validade das credenciais |
| Eventos não configurados | Conferir assinaturas da WABA e campos ativos do app |
| `CONNECTED` com `ON_PREMISE` | A Cloud API ainda não está confirmada; consultar novamente e revisar o onboarding |
| `ACCOUNT_RECONNECTED` recebido | Aguardar a verificação independente; não forçar o estado no banco |

## Implantação e reversão

1. Fazer backup do banco conforme o runbook existente e registrar a revisão/imagem atual.
2. Manter `META_EMBEDDED_SIGNUP_ENABLED=false` durante a primeira implantação.
3. Gerar o cliente Prisma e aplicar `202609100001_meta_connection_state` e `202609100002_meta_connection_attempts` usando `npm run db:deploy` no ambiente correto. Ambas são aditivas; não executar seed ou reset no banco da loja.
4. Publicar a aplicação pelo procedimento existente, preservando PostgreSQL, volumes de mídia e outros serviços. Conferir healthcheck, sessão administrativa e `/configuracoes/meta`.
5. Atualizar o diagnóstico e validar as assinaturas. Só então configurar os IDs e habilitar a flag para o onboarding assistido no celular principal.
6. Após concluir, confirmar a conexão na tela. Usar apenas destinatário de teste autorizado para validar entrada/saída e a sincronização de mensagens do aparelho principal. Vincular os aparelhos adicionais novamente.

Para suspender novas reconexões, voltar a flag para `false` e recriar somente o app. Isso não desliga o bloqueio de envios por desconexão confirmada. Para rollback de código, usar uma imagem anterior compatível com as migrações aditivas, mantendo o banco. Não apagar migrações aplicadas, restaurar banco sem necessidade, desregistrar o número nem trocar os ativos Meta como procedimento de rollback. Uma versão anterior sem o bloqueio exige cuidado operacional com os envios.

Importação de histórico, criação de WABA/número, alteração de credencial permanente, registro/desregistro do número e reconexão automática dos celulares estão fora desta implementação. O histórico já salvo na central é preservado.

## Referências oficiais

Consultadas em 10/09/2026:

- [Implementação do Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
- [Coexistência com o WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/)
- [Reconectar clientes de coexistência](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients/)
- [Eventos account_update](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update/)
