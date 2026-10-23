// 라우트 페이지 지연 청크(R7 성능 O1). /vet(VetPage + VetMap·useNaverMapLoader·VetReportForm)은 /vet 문서에서만 불러온다.
import type { VetPageProps } from '../vet/VetPage';
import { preloadable } from './preloadable';

export const vetPageChunk = preloadable<VetPageProps>(() => import('../vet/VetPage'), 'VetPage');
