# Contribuindo

Obrigado por olhar o projeto. Lembre que o jevdedup é um exercício para testar o
Jev (TypeSafe AI), então mudanças que exploram melhor o SDK são especialmente
bem-vindas.

## Antes de abrir um PR

```bash
make check
```

É exatamente o que o CI roda: checagem de tipos, testes e build.

## Regras de casa

- Teste nasce junto com o código. Caminho feliz sozinho não conta: cubra
  entrada inválida, arquivo inacessível, falha de rede e casos de borda.
- Nunca ajuste um teste só para ele passar. Teste falhando quer dizer que o
  código está errado até prova em contrário, e a prova vai no commit.
- Nada de chave de API, token ou dado pessoal no repositório. Use `.env`.
- O CLI nunca deleta arquivo do usuário. Relatório é relatório.

## Bugs e ideias

Abra uma issue com o comando que você rodou, a saída e o que esperava.
