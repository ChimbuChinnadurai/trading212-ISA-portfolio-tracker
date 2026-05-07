.PHONY: setup run clean lock docker docker-run release

setup:
	@bash scripts/setup.sh

run:
	uv run python app.py

lock:
	uv lock

clean:
	rm -rf .venv __pycache__ **/__pycache__

docker:
	docker build --platform=linux/amd64 -t tracker .

docker-run:
	docker run -p 8080:8080 --env-file .env tracker

release:
	@bash scripts/release.sh $(ARGS)
