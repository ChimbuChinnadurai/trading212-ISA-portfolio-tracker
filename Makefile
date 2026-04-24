VENV   := .venv
PYTHON := $(VENV)/bin/python
PIP    := $(VENV)/bin/pip

.PHONY: setup run clean freeze docker docker-run release

setup:
	@bash scripts/setup.sh

run: $(VENV)/bin/activate
	$(PYTHON) app.py

$(VENV)/bin/activate: requirements.txt
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip --quiet
	$(PIP) install -r requirements.txt --quiet

freeze:
	$(PIP) freeze > requirements.txt

clean:
	rm -rf $(VENV) __pycache__ **/__pycache__

docker:
	docker build --platform=linux/amd64 -t tracker .

docker-run:
	docker run -p 8080:8080 --env-file .env tracker

release:
	@bash scripts/release.sh $(ARGS)
