# 배포 목적과 초기 설정

## 배포를 먼저 진행하는 이유

개발 환경과 관계없이 브라우저로 개발 결과를 확인하기 위해, 지도나 부동산 기능을 구현하기 전에 React 초기 화면부터 GitHub Pages에 게시한다. 이후에도 같은 공개 주소에서 변경 사항을 확인할 수 있도록 한다.

배포 대상은 공개 GitHub 저장소의 GitHub Pages다. 별도 호스팅 서비스나 유료 상품은 사용하지 않는다. 자동화의 실제 동작과 설정은 [배포 워크플로](../.github/workflows/deploy.yml)와 [Vite 설정](../vite.config.ts)을 참조한다.

## 저장소 소유자의 초기 설정

현재 작업 환경에서는 GitHub 설정 API 호출이 `Forbidden`으로 거부되며, 연결된 GitHub 도구도 Pages 설정 변경 기능을 제공하지 않는다. 따라서 아래 설정은 저장소 소유자가 GitHub에 로그인한 브라우저에서 확인한다. 설정을 이미 마쳤다면 같은 값을 유지한다.

1. [저장소 Pages 설정](https://github.com/hyeonjin-kim-dev/galmanzip/settings/pages)을 연다.
2. **Build and deployment → Source**에서 **GitHub Actions**를 선택한다. 새 워크플로를 만드는 템플릿은 선택하지 않는다. 저장소에 배포 워크플로가 준비되어 있다.
3. [갈만집 배포 워크플로](https://github.com/hyeonjin-kim-dev/galmanzip/actions/workflows/deploy.yml)를 연다. **Run workflow**를 누르고 **Branch: main**을 선택한 뒤, 초록색 **Run workflow** 버튼을 누른다.
4. 실행 결과가 초록색 성공으로 표시되면 Pages 설정으로 돌아가 **Visit site**를 눌러 초기 화면을 확인한다.

기본 주소는 [갈만집](https://hyeonjin-kim-dev.github.io/galmanzip/)으로 예상하지만, 실제 게시 주소와 성공 여부는 GitHub Pages 설정 및 배포 실행 결과를 기준으로 확인한다. 배포 설정 파일을 푸시했다는 사실만으로 게시 완료로 보고하지 않는다.

근거: [GitHub Pages 게시 소스 설정](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [Vite의 GitHub Pages 배포 안내](https://vite.dev/guide/static-deploy.html#github-pages).
