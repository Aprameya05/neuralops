import os
os.environ['NEURALOPS_ENDPOINT'] = 'https://neuralops-api-cmgf.onrender.com'
import asyncio, sys, os 
sys.path.insert(0, 'sdk') 
sys.path.insert(0, '.') 
from dotenv import load_dotenv 
load_dotenv('.env') 
from server.agents.pipeline import run_full_pipeline 
async def test(): 
    result = await run_full_pipeline('What is observability in distributed systems?') 
    print('Done. Causal chain:', result.causal_chain_id) 
asyncio.run(test()) 
