# jevdedup

> **Leia primeiro:** este é um projeto de exercício, criado para testar o Jev,
> o modelo da [TypeSafe AI](https://typesafe.ai), e exercitar o SDK deles. Não é
> um produto, não tem garantia de nada e parte do valor do repositório é
> justamente observar onde o Jev acerta e onde ele erra. É um laboratório de um
> uso específico de IA, não uma ferramenta de limpeza de disco confiável.

CLI em [Bun](https://bun.com) que encontra arquivos duplicados numa pasta. As
verificações padrão (tamanho, hash rápido, SHA-256 completo) fazem o trabalho
pesado; o Jev entra depois, para conferir cada grupo, dar um veredito e sugerir
qual cópia manter. O mesmo vale para pares suspeitos que os hashes não pegam:
mesmo nome com conteúdo diferente, ou bytes quase idênticos.

Nada é deletado. O jevdedup só gera relatório.

## O que ele faz

1. **Scan** recursivo da pasta (symlinks são ignorados, `.git` é pulado).
2. **Agrupa por tamanho**: arquivos de tamanhos diferentes nunca são duplicatas.
3. **Hash rápido**: primeiros e últimos 64 KB + tamanho, para descartar o óbvio.
4. **SHA-256 completo** só nos sobreviventes: grupos com hash igual são
   duplicatas exatas.
5. **Jev confirma cada grupo**: são duplicatas de verdade? Algum arquivo está
   rotulado errado (mesmo conteúdo com nomes e extensões que não batem)? Qual
   cópia vale manter?
6. **Pares semânticos**: mesmo nome de arquivo com bytes diferentes, ou bytes
   quase idênticos com hash diferente, vão para o Jev decidir se são o mesmo
   conteúdo com edições pequenas.

## Instalação

Requisitos: [Bun](https://bun.com) 1.1 ou mais novo.

```bash
git clone https://git.ruivalim.com.br/ruivalim/jevdedup
cd jevdedup
make setup                # bun install + cria .env a partir do exemplo
# edite .env e coloque sua TYPESAFE_API_KEY
make install              # bun link: instala o comando `jevdedup`
```

Sem `bun link`, dá para rodar direto (`bun run src/cli.ts <pasta>`) ou compilar
um binário standalone com `make build` (sai em `dist/jevdedup`).

## Uso

```bash
jevdedup ~/Downloads                    # relatório com veredito do Jev
jevdedup ~/Fotos --min-size 1MB --exclude "raw/**"
jevdedup . --json > relatorio.json      # saída máquina
jevdedup . --no-jev                     # offline, só o clássico
jevdedup . --fail-on-duplicates         # exit code 2 se achar algo (CI)
```

### Opções

| Opção | O que faz |
| --- | --- |
| `--json` | relatório JSON em stdout (progresso continua em stderr) |
| `--no-jev` | só verificações clássicas, nenhuma chamada de rede |
| `--require-jev` | falha se não houver `TYPESAFE_API_KEY` em vez de degradar |
| `--no-semantic` | não procura pares semânticos, só duplicatas exatas |
| `--min-size <tamanho>` | ignora arquivos menores (`1KB`, `5MB`, ou bytes puros) |
| `--exclude <glob>` | pula caminhos que batem com o glob (repetível) |
| `--model <nome>` | modelo do Jev (padrão `jev-latest`) |
| `--concurrency <n>` | paralelismo de hashing e de chamadas (padrão 8 e 4) |
| `--max-jev-calls <n>` | orçamento de chamadas do Jev por execução (padrão 50) |
| `--fail-on-duplicates` | exit code 2 quando encontra duplicatas |

Códigos de saída: `0` tudo certo, `1` erro, `2` achou duplicatas com
`--fail-on-duplicates`.

## Onde o Jev entra

Cada grupo de duplicatas exatas vira uma chamada `systemOne` com os metadados e
um trecho de texto dos arquivos (arquivos binários nunca são enviados, só os
metadados). Três perguntas:

- **verdict** (`choice`): `true_duplicate`, `mislabeled` ou `unsure`.
- **safe_to_keep_one** (`noul`): manter uma cópia perde alguma informação?
- **keep** (`choice`): qual caminho é a melhor cópia canônica.

Pares semânticos recebem duas perguntas: `same_content` (`noul`) e `relation`
(`choice` entre edições pequenas, dupla exportação ou conteúdo diferente). O
relatório mostra a resposta e os números crus (probabilidade, confiança, uso de
tokens), porque o Jev é probabilístico e às vezes se contradiz: a decisão final
é sua.

## A chave da API

O Jev é pago e requer chave. Pegue uma em
[console.typesafe.ai/keys](https://console.typesafe.ai/keys) e coloque no `.env`
(nunca commitado):

```bash
TYPESAFE_API_KEY=sua_chave_aqui
```

Sem chave, o jevdedup funciona igual, mas só com as verificações clássicas e um
aviso.

## Desenvolvimento

```bash
make help    # todos os alvos
make check   # o mesmo que o CI roda: tipos, testes, build
```

Os testes não gastam tokens: as chamadas ao Jev são mockadas. Para uma
verificação ao vivo contra a API real:

```bash
JEV_LIVE=1 bun test test/jev.live.test.ts
```

Contribuições são bem-vindas, veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE)
