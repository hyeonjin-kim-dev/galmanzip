# 카카오모빌리티 제휴 API의 이전 검토

이 문서는 현재 채택하지 않은 상품의 조사 기록이다. 사용자는 2026년 11월 1일 외부 길찾기 API 사용 요청을 철회하고 서버 없는 자체 계산을 명시했다. 현재 지침은 [경로 검색 원칙](routing-policy.md)이다. 아래 절차를 현재 작업의 선행 조건으로 요구하지 않는다.

## 이전에 확인한 제약

- 요청했던 [카카오모빌리티 대중교통 통합 길찾기](https://developers.kakaomobility.com/affiliate/publictransit/multimodal)는 제휴 상품이다. [제휴 안내](https://developers.kakaomobility.com/affiliate/)와 [시작하기](https://developers.kakaomobility.com/affiliate/publictransit/start.html)는 사전 계약과 계정 승인을 요구한다. 카카오 개발자·비즈니스 가입이나 지도 활성화만으로 해당 승인이 확인되지는 않았다.
- [공개 가격표](https://developers.kakaomobility.com/price/)에서 이 상품의 무료 제공량을 확인하지 못했다. 다른 카카오 상품의 무료 쿼터를 제휴 상품에 적용한다고 단정하지 않았다.
- 출발지·목적지 한 쌍을 조회하는 API이므로 목적지로 도착 가능한 서울·경기 전체 아파트를 한 번에 반환하는 기능으로 간주하지 않았다.
- 브라우저 직접 호출·CORS·REST 키 보호는 실제 서비스에서 검증하지 못했다. Actions 비밀값을 클라이언트 번들에 넣어도 공개된다는 제약이 있었다.

사용자가 이후 제시한 [2024년 단기 캐싱 답변](https://devtalk.kakao.com/t/api/140197)은 주소·좌표 변환에 관한 내용이다. 이를 길찾기 상품의 응답 저장 허가로 확대 해석하지 않는다. 앞으로 외부 경로 API를 다시 검토한다면 실제 상품의 최신 이용 조건을 확인한다. 비용 미지출과 서버 미운영 원칙 변경 없이 유료 계약·결제 설정·중계 서버를 도입하지 않는다.

과거의 API 준비 코드는 [당시 커밋](https://github.com/hyeonjin-kim-dev/galmanzip/tree/694dd2e/src/search)에서 확인할 수 있다. 모의 응답 검사가 통과한 상태와 승인된 실제 호출 성공은 구분한다.
