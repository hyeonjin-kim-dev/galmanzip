# Kakao 지도 외부 설정

## 필요한 이유

Kakao 지도 Web SDK를 사용하려면 서비스 소유자의 카카오 앱과 JavaScript 키, 등록된 도메인이 필요하다. 키 발급과 카카오 앱 설정은 연결된 도구로 처리할 수 없어 소유자가 한 번 준비해야 한다. 외부 앱의 초기 설정과 이후 코드 배포를 구분한다.

브라우저에 전달되는 JavaScript 키만 지도에 사용한다. REST API 키나 어드민 키로 대체하지 않는다. 무료 이용 원칙에 맞는 카카오맵 무료 쿼터 적용 여부를 확인하고 유료 API 사용을 설정하지 않는다.

## 카카오 앱 설정

1. [Kakao Developers 앱 목록](https://developers.kakao.com/console/app)에 로그인해 서비스 앱을 선택하거나 생성한다.
2. 앱의 **카카오맵 → 사용 설정**에서 상태를 **ON**으로 설정한다. 앱 정보의 **카카오맵 무료 쿼터** 표시를 확인한다. 무료 쿼터는 개발자 계정의 첫 카카오맵 활성화 앱에 제공되므로 기존 앱이 있다면 확인 후 사용한다.
3. **앱 → 플랫폼 키 → JavaScript 키**를 열고 **JavaScript SDK 도메인**에 `https://hyeonjin-kim-dev.github.io`를 등록한다. 배포 경로인 `/galmanzip/`은 도메인에 붙이지 않는다.
4. 해당 화면의 **JavaScript 키** 값을 복사한다.

로컬 개발도 할 때에는 사용하는 로컬 서버의 출처를 추가로 등록한다. 배포 사이트의 지도 표시에 로컬 도메인 등록까지 필요한 것은 아니다.

## GitHub 배포에 연결

1. [저장소 Actions 변수 설정](https://github.com/hyeonjin-kim-dev/galmanzip/settings/variables/actions)을 연다. 직접 이동할 때에는 **Settings → Secrets and variables → Actions → Variables** 순서다.
2. **New repository variable**을 누른다.
3. **Name**에는 [환경변수 양식](../.env.example)의 지도 키 항목 이름을, **Value**에는 위에서 복사한 JavaScript 키를 입력하고 **Add variable**을 누른다. 실제 참조 방식은 [배포 워크플로](../.github/workflows/deploy.yml)를 따른다.
4. 등록 완료를 에이전트에게 알린다. 에이전트가 준비한 변경을 배포 대상 브랜치에 반영하고 자동 배포를 확인한다. 사용자가 매번 수동 실행하는 절차는 필요하지 않다.

변수 등록만으로 이미 생성된 배포 파일이 바뀌지는 않는다. 등록 이후 새 빌드가 필요하다. 키가 브라우저에서 사용된다는 점은 저장소 변수로 관리해도 달라지지 않으므로 카카오의 허용 도메인 설정을 함께 적용한다.

## 검증 기준

화면 크기 대응이나 모의 SDK 검증과 실제 지도 표시 성공을 구분한다. JavaScript 키가 등록된 배포에서 Kakao SDK와 타일이 실제로 표시되는지 확인하기 전에는 지도 표시가 완료됐다고 보고하지 않는다.

2026년 10월 31일 사용자가 외부 설정 등록을 완료했다고 알렸다. 이후 [지도 화면 자동 배포](https://github.com/hyeonjin-kim-dev/galmanzip/actions/runs/41197129729)에서 지도 키 존재 확인·타입 검사·빌드 및 Pages 게시가 모두 성공했다. 작업 환경의 네트워크 허용 목록에 배포 사이트와 Kakao 호스트가 포함되어 있지 않아 실제 지도 타일 표시를 직접 검증하지는 못했다. 배포 성공과 브라우저에서의 지도 표시 검증을 구분한다.

근거: [지도 Web SDK 시작 안내](https://apis.map.kakao.com/web/guide/), [카카오맵 사용 방법](https://developers.kakao.com/docs/ko/kakaomap/common), [JavaScript 키와 도메인 설정](https://developers.kakao.com/docs/ko/app-setting/app#platform-key-javascript), [GitHub 저장소 변수 설정](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables).
