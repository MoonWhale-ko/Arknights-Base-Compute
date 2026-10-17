import {parentPort} from 'node:worker_threads';
import {createEvaluationHandler} from './evaluation-jobs.mjs';
const handleEvaluation=createEvaluationHandler();
parentPort.on('message',data=>{const result=handleEvaluation(data);if(result)parentPort.postMessage(result);});
