import {createEvaluationHandler} from './evaluation-jobs.mjs';
const handleEvaluation=createEvaluationHandler();
self.onmessage=({data})=>{const result=handleEvaluation(data);if(result)self.postMessage(result);};
