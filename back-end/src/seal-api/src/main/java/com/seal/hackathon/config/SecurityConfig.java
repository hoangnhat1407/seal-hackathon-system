package com.seal.hackathon.config;

import com.seal.hackathon.security.CsrfCookieFilter;
import com.seal.hackathon.security.JwtAuthenticationEntryPoint;
import com.seal.hackathon.security.JwtAuthenticationFilter;
import com.seal.hackathon.security.InactiveParticipantWriteFilter;
import com.seal.hackathon.security.SpaCsrfTokenRequestHandler;
import com.seal.hackathon.security.oauth2.CustomOAuth2UserService;
import com.seal.hackathon.security.oauth2.OAuth2LoginFailureHandler;
import com.seal.hackathon.security.oauth2.OAuth2LoginSuccessHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * Main Spring Security configuration.
 *
 * Key decisions:
 * - CSRF is enabled using the double-submit-cookie pattern (XSRF-TOKEN cookie
 *   + X-XSRF-TOKEN header), since auth now rides on an HttpOnly cookie that
 *   browsers attach automatically to any request, same-site or not.
 * - Sessions are created only when needed. OAuth2 needs a short-lived session
 *   to store the authorization state between provider redirects; API auth still
 *   uses a JWT cookie, not a server-side session.
 * - JWT filter runs before UsernamePasswordAuthenticationFilter.
 * - OAuth2 login sets the JWT cookie directly and redirects to the frontend
 *   (no token in the URL).
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity                   // enables @PreAuthorize on controller methods
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final InactiveParticipantWriteFilter inactiveParticipantWriteFilter;
    private final JwtAuthenticationEntryPoint jwtAuthenticationEntryPoint;
    private final CustomOAuth2UserService customOAuth2UserService;
    private final OAuth2LoginSuccessHandler oAuth2LoginSuccessHandler;
    private final OAuth2LoginFailureHandler oAuth2LoginFailureHandler;
    private final SpaCsrfTokenRequestHandler spaCsrfTokenRequestHandler;
    private final CsrfCookieFilter csrfCookieFilter;

    @Value("${app.frontend.url:http://localhost:5173}")
    private String frontendUrl;

    @Value("${app.jwt.cookie.secure}")
    private boolean cookieSecure;

    @Value("${app.csrf.cookie.domain:}")
    private String csrfCookieDomain;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // Double-submit-cookie CSRF: XSRF-TOKEN cookie (JS-readable, unlike the
            // auth cookie) is echoed back by the SPA as the X-XSRF-TOKEN header.
            // Requests authenticated via "Authorization: Bearer" are exempt — a
            // browser can never be tricked into attaching that header cross-site
            // the way it auto-attaches cookies, so CSRF doesn't apply to them
            // (this is also what lets API tooling like Postman/Swagger call
            // write endpoints with just a bearer token, no CSRF dance needed).
            .csrf(csrf -> csrf
                .csrfTokenRepository(csrfTokenRepository())
                .csrfTokenRequestHandler(spaCsrfTokenRequestHandler)
                .ignoringRequestMatchers(
                    "/api/auth/login",
                    "/api/auth/register",
                    "/api/auth/forgot-password",
                    "/api/auth/verify-reset-otp",
                    "/api/auth/reset-password"
                )
                .ignoringRequestMatchers(bearerAuthRequestMatcher()))

            // Enable CORS with the configuration below
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))

            // OAuth2 needs a transient session to preserve state across the
            // Google/GitHub redirect. Normal API requests still authenticate
            // with JWT and do not require a server-side session.
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))

            // Without this, Spring's default HttpSessionSecurityContextRepository
            // would silently persist the JWT-derived Authentication into a
            // JSESSIONID-backed session on every request (since IF_REQUIRED allows
            // session creation for the OAuth2 flow above). That would make the
            // session cookie an independent, un-revocable auth channel — logout
            // and JWT expiry would stop meaning anything. Keep the SecurityContext
            // request-scoped only; re-derive it from the cookie every time.
            .securityContext(securityContext ->
                securityContext.securityContextRepository(new RequestAttributeSecurityContextRepository()))

            // Return JSON 401 instead of redirect to /login
            .exceptionHandling(ex ->
                ex.authenticationEntryPoint(jwtAuthenticationEntryPoint))

            // URL-level authorization rules
            .authorizeHttpRequests(auth -> auth
                // Public: only the genuinely anonymous auth endpoints. Everything
                // else under /api/auth/** (me, complete-profile, me/password,
                // me/avatar) falls through to anyRequest().authenticated() below —
                // AuthController casts Authentication.getPrincipal() unconditionally,
                // so an unauthenticated call must be rejected here, before it
                // reaches the controller, not inside it.
                .requestMatchers(HttpMethod.POST,
                        "/api/auth/register", "/api/auth/login", "/api/auth/forgot-password",
                        "/api/auth/verify-reset-otp", "/api/auth/reset-password", "/api/auth/logout"
                ).permitAll()
                .requestMatchers(HttpMethod.GET, "/api/auth/check-student-id").permitAll()
                // Public: CSRF bootstrap — lets the SPA obtain an XSRF-TOKEN cookie
                // before logging in / before its first state-changing request.
                .requestMatchers(HttpMethod.GET, "/api/csrf").permitAll()
                // Public: OAuth2 flow
                .requestMatchers("/oauth2/**", "/login/oauth2/**").permitAll()
                // Public: error page
                .requestMatchers("/error").permitAll()
                // Public: Swagger UI (remove in production if desired)
                .requestMatchers("/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                // Public: uploaded files (avatars, etc.)
                .requestMatchers("/uploads/**").permitAll()
                // Public: list all hackathon events
                .requestMatchers("/api/events/**").permitAll()
                // Admin runs the PLATFORM: global users, role grants, system logs
                .requestMatchers("/api/admin/**").hasRole("SYSTEM_ADMIN")
                .requestMatchers("/api/participation-requests/**").hasRole("PARTICIPANT")
                // Mentor-support requests — participants raise/cancel; mentor side is under /api/mentor/**
                .requestMatchers("/api/support-requests/**").hasRole("PARTICIPANT")
                // Coordinator runs the COMPETITION: events, rounds, approvals, assignments
                .requestMatchers("/api/coordinator/**").hasRole("EVENT_COORDINATOR")
                .requestMatchers("/api/account-approvals/**").hasRole("EVENT_COORDINATOR")
                // Join requests — participants only; leader checks happen in service
                .requestMatchers("/api/join-requests/**").hasRole("PARTICIPANT")
                // Participants access team endpoints
                .requestMatchers("/api/teams/**")
                    .hasAnyRole("PARTICIPANT", "EVENT_COORDINATOR")
                // Submissions: participants submit/view their own, judges list a round
                // to score. Fine-grained access is enforced per-endpoint via @PreAuthorize.
                .requestMatchers("/api/submissions/**")
                    .hasAnyRole("PARTICIPANT", "EVENT_COORDINATOR", "JUDGE")
                // Judges access scoring endpoints
                .requestMatchers("/api/scores/**", "/api/judge/**").hasAnyRole("JUDGE", "EVENT_COORDINATOR")
                // AI Judge Assistant — advisory submission insights for scoring staff
                .requestMatchers("/api/ai/**").hasAnyRole("JUDGE", "EVENT_COORDINATOR")
                // Mentors access mentor endpoints
                .requestMatchers("/api/mentor/**").hasAnyRole("MENTOR", "EVENT_COORDINATOR")
                // Notifications — any authenticated user
                .requestMatchers("/api/notifications/**").authenticated()
                // Invitations — participants
                .requestMatchers("/api/invites/**").hasAnyRole("PARTICIPANT", "EVENT_COORDINATOR")
                // Join requests — participants
                .requestMatchers("/api/join-requests/**").hasRole("PARTICIPANT")
                // Round results — public for published, coordinator for all
                .requestMatchers("/api/events/*/rounds/*/results/**").authenticated()
                // Everything else must be authenticated
                .anyRequest().authenticated()
            )

            // OAuth2 login configuration
            .oauth2Login(oauth2 -> oauth2
                // Where the frontend sends user to start OAuth2 flow
                .authorizationEndpoint(a -> a.baseUri("/oauth2/authorization"))
                // Where Google/GitHub redirect back to
                .redirectionEndpoint(r -> r.baseUri("/login/oauth2/code/*"))
                // Our custom user service creates/updates the User entity
                .userInfoEndpoint(u -> u.userService(customOAuth2UserService))
                // On success: generate JWT and redirect to frontend
                .successHandler(oAuth2LoginSuccessHandler)
                // On failure: log the real cause and return the user to the SPA
                .failureHandler(oAuth2LoginFailureHandler)
            )

            // JWT validation runs before Spring Security's default auth filter
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(inactiveParticipantWriteFilter, JwtAuthenticationFilter.class)
            // Forces eager CSRF token resolution so the XSRF-TOKEN cookie is written
            // on every request, not just ones that end up reading the token.
            .addFilterAfter(csrfCookieFilter, CsrfFilter.class);

        return http.build();
    }

    // XSRF-TOKEN must be readable by JS (httpOnlyFalse) so the SPA can echo it
    // back as the X-XSRF-TOKEN header — unlike the JWT cookie, this one carries
    // no secret, only a per-session anti-forgery value.
    @Bean
    public CsrfTokenRepository csrfTokenRepository() {
        CookieCsrfTokenRepository repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setCookieCustomizer(cookie -> {
            cookie.secure(cookieSecure).sameSite("Lax").path("/");
            // Production serves the SPA and API from sibling subdomains. A host-only
            // cookie issued by api.example.com is invisible to JavaScript on
            // example.com, so the SPA cannot echo it as X-XSRF-TOKEN. Keep this
            // optional so localhost development continues to use a host-only cookie.
            if (csrfCookieDomain != null && !csrfCookieDomain.isBlank()) {
                cookie.domain(csrfCookieDomain.trim());
            }
        });
        return repository;
    }

    // Matches any request carrying "Authorization: Bearer ..." — used to exempt
    // bearer-authenticated calls (Postman, Swagger, JwtAuthenticationFilter's
    // header fallback) from CSRF, since a browser can't be tricked into sending
    // that header cross-site the way it auto-sends cookies.
    private RequestMatcher bearerAuthRequestMatcher() {
        return request -> {
            String authHeader = request.getHeader("Authorization");
            return authHeader != null && authHeader.startsWith("Bearer ");
        };
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();

        // Allow requests from the local dev server and the deployed frontend.
        config.setAllowedOrigins(List.of("http://localhost:5173", frontendUrl));

        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        // Let the browser read the file name from downloads (track "đề thi", exports).
        config.setExposedHeaders(List.of("Content-Disposition"));

        // Required — the JWT and CSRF cookies only travel cross-origin (frontend
        // and API are different subdomains) if the browser is told to send them.
        config.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
