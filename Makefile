# jevdedup: encontra arquivos duplicados e usa o Jev (TypeSafe AI) para conferir cada grupo
#
# `make` ou `make help` lista os alvos. Este Makefile é uma fachada: cada alvo
# delega pra ferramenta de verdade (bun). Regra nova entra com `## descrição`
# na mesma linha pra aparecer no help.

SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
MAKEFLAGS += --warn-undefined-variables --no-builtin-rules --no-print-directory
.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

# ---------------------------------------------------------------------------
# Variáveis (?= permite sobrescrever: `make run DIR=~/Downloads`)
# ---------------------------------------------------------------------------

APP     ?= $(notdir $(CURDIR))
BIN_DIR ?= dist
DIR     ?= .

# Cores só quando stdout é um terminal (pipe e CI ficam limpos)
BOLD  :=
CYAN  :=
GREEN :=
RESET :=
ifneq ($(shell [ -t 1 ] && echo tty),)
  BOLD  := $(shell tput bold 2>/dev/null)
  CYAN  := $(shell tput setaf 6 2>/dev/null)
  GREEN := $(shell tput setaf 2 2>/dev/null)
  RESET := $(shell tput sgr0 2>/dev/null)
endif

##@ Geral

.PHONY: help
help: ## Lista os alvos disponíveis
	@awk 'BEGIN { FS = ":.*##"; printf "\n$(BOLD)$(APP)$(RESET)\n\nUso: make $(CYAN)<alvo>$(RESET)\n" } \
	  /^##@/ { printf "\n$(BOLD)%s$(RESET)\n", substr($$0, 5) } \
	  /^[a-zA-Z0-9_.\/-]+:.*?##/ { printf "  $(CYAN)%-18s$(RESET) %s\n", $$1, $$2 } \
	  END { printf "\n" }' $(MAKEFILE_LIST)

.PHONY: setup
setup: ## Instala dependências e prepara o ambiente local
	@echo "$(GREEN)▸ setup$(RESET)"
	bun install
	test -f .env || cp .env.example .env

.PHONY: install
install: ## Instala o comando jevdedup neste computador (bun link)
	@echo "$(GREEN)▸ install$(RESET)"
	bun link

##@ Desenvolvimento

.PHONY: run
run: ## Roda o CLI (DIR=pasta a analisar, padrão .)
	@echo "$(GREEN)▸ run $(DIR)$(RESET)"
	bun run src/cli.ts $(DIR)

##@ Qualidade

.PHONY: lint
lint: ## Checagem de tipos, sem modificar nada
	@echo "$(GREEN)▸ lint$(RESET)"
	bunx tsc --noEmit

.PHONY: test
test: ## Roda os testes
	@echo "$(GREEN)▸ test$(RESET)"
	bun test

.PHONY: check
check: lint test build ## Tudo que o CI roda: lint, test, build
	@echo "$(GREEN)✓ check ok$(RESET)"

##@ Build

.PHONY: build
build: ## Compila binário standalone em BIN_DIR (padrão dist/)
	@echo "$(GREEN)▸ build$(RESET)"
	@mkdir -p $(BIN_DIR)
	bun build --compile src/cli.ts --outfile $(BIN_DIR)/$(APP)

.PHONY: clean
clean: ## Remove artefatos gerados
	@echo "$(GREEN)▸ clean$(RESET)"
	rm -rf $(BIN_DIR) coverage
