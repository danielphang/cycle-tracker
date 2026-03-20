.PHONY: setup run dev

setup:
	pip install -r requirements.txt
	cp -n .env.example .env || true

run:
	python3 server.py

dev:
	python3 server.py
