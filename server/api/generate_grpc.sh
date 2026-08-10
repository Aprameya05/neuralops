#!/bin/bash
# Run from D:\neuralops\server\api to generate gRPC stubs
# Requires: pip install grpcio-tools

python -m grpc_tools.protoc \
  -I. \
  --python_out=. \
  --grpc_python_out=. \
  neuralops.proto

echo "Generated neuralops_pb2.py and neuralops_pb2_grpc.py"
